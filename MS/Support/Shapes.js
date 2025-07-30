define(["esri/geometry/Polyline", "esri/geometry/Point", "MilSymbologyExt/GeoTools",
        "MilSymbologyComponents/Echelons"
    ],

    function(Polyline, Point, GeoTools,
        Echelons) {

        return {
            createC: function(pt, radius, steps) {
                var pts = [];
                var step = 2 * Math.PI / steps;
                var xh = pt.x;
                var yk = pt.y;
                var r = radius;
                for (var theta = 1.1; theta < 1.1 + Math.PI; theta += step) {
                    var x = xh + r * Math.cos(theta);
                    var y = yk - r * Math.sin(theta);
                    pts.push(new Point(x, y, pt.spatialReference));
                }

                return pts;
            },




            /*
             CreateEllipse:  function(pt, radius, steps) { //Not used
                var pts = [];
                var step = 2 * Math.PI / steps;
                var xh = pt.x; 
                var yk = pt.y;
                var r = radius;
               for(var theta = 0;  theta < 2 * Math.PI;  theta += step)  { 
                  var x = xh + r * 0.3 * Math.cos(theta);
                  var y = yk + 0.5 * r*Math.sin(theta);
                  pts.push(new Point(x,y, pt.spatialReference));
                }
               
               return pts;
            },
            */

            createEllipse: function(a) {
                var x = a.center.x,
                    y = a.center.y,
                    longAxis = a.longAxis,
                    shortAxis = a.shortAxis,
                    numberOfPoints = a.numberOfPoints,
                    map = a.map,
                    g, m, k;
                var paths = [];
                var steps = 2 * Math.PI / numberOfPoints;
                for (m = 0; m < numberOfPoints; m++) g = map.toMap({
                    x: longAxis * Math.cos(m * steps) + x,
                    y: shortAxis * Math.sin(m * steps) + y
                }), paths.push(g);
                paths.push(paths[0]);
                var result = new Polyline(map.spatialReference);
                result.addPath(paths);
                return paths;
            },

            createCircle: function(pt, radius, steps) {
                var pts = [];
                var step = 2 * Math.PI / steps;
                var xh = pt.x;
                var yk = pt.y;
                var r = radius;
                for (var theta = 0; theta < 2 * Math.PI; theta += step) {
                    var x = xh + r * Math.cos(theta);
                    var y = yk - r * Math.sin(theta);
                    pts.push(new Point(x, y, pt.spatialReference));
                }

                return pts;
            },

            createHalfCircle: function(pt, radius, thetaStart, thetaEnd, steps) {

                var pts = [];
                var step = 2 * Math.PI / steps;
                var xh = pt.x;
                var yk = pt.y;
                var r = radius;

                for (var theta = thetaStart; theta < 2 * Math.PI + thetaEnd; theta += step) {
                    var x = xh + r * Math.cos(theta);
                    var y = yk - r * Math.sin(theta);
                    pts.push(new Point(x, y, pt.spatialReference));
                }
                return pts;
            },


            createFLOTHalfCircle: function(pt, angle, radius) {

                var pts = [];
                var steps = 30;
                steps = 2 * Math.PI / steps;
                var xh = pt.x;
                var yk = pt.y;
                var r = radius;

                for (var theta = 0; theta <= 3.1765; theta += steps) {
                    var x = xh + r * Math.cos(theta);
                    var y = yk - r * Math.sin(theta);
                    pts.push(new Point(x, y, pt.spatialReference));
                }

                return this.ownRotate(pts, pt.x, pt.y, angle);
            },


            createB: function(pt, radius, steps) {
                var paths = [];
                paths = paths.concat(this.createHalfCircle(new Point(pt.x - radius / 5.6, pt.y - radius / 2, pt.spatialReference), radius / 2, 4.7, 2.0, 40),
                    this.createHalfCircle(new Point(pt.x - radius / 5.6, pt.y + radius / 2, pt.spatialReference), radius / 2, 4.4, 1.6, 40));
                return paths;

            },


            createPL: function(dx, dy, dr, sp) {
                var pts = [];
                pts = this.createDD(dx, dy + (dr / 2), dr / 2, sp);
                pts.push(new Point(dx - ((dr / 2) / 3), dy, sp));
                pts.push(new Point(dx - ((dr / 2) / 3), dy - dr, sp));


                return [pts, this.createL(dx + (dr * 1.3), dy, dr, sp)];
            },

            createSL: function(dx, dy, dr, sp) {
                var pts = [];
                pts = this.createS(dx, dy, dr, sp);
                return [pts, this.createL(dx + (dr * 1.3), dy, dr, sp)];
            },

            createKG: function(dx, dy, dr, sp) {
                var pts = [];
                var temp = [];
                pts = this.createK(dx - (dr), dy, dr, sp);
                temp = this.createG(dx + (dr * 1.5), dy, dr, sp);
                return [pts, temp[0], temp[1]];                
            },


            createKZ: function(dx, dy, dr, sp) {
                var pts = [];
                pts = this.createK(dx - (dr * 1.2), dy, dr, sp);
                return [pts, this.createZ(dx, dy, dr, sp)];                
            },

            createLZ: function(dx, dy, dr, sp) {
                var pts = [];
                pts = this.createL(dx - (dr * 1.2), dy, dr, sp);
                return [pts, this.createZ(dx, dy, dr, sp)];                
            },

            createVG: function(dx, dy, dr, sp) {
                var pts = [];
                var temp = [];
                pts = this.createV(dx - (dr), dy, dr, sp);
                temp = this.createG(dx + (dr * 1.2), dy, dr, sp);
                return [pts, temp[0], temp[1]];                
            },

            createVA: function(dx, dy, dr, sp) {
                var pts = [];
                pts = this.createV(dx, dy, dr, sp);
                return [pts, this.createA(dx + (dr * 1.2), dy, dr, sp)];                
            },

            createBL: function(dx, dy, dr, sp) {
                var pts = [];
                pts = this.createB(new Point(dx, dy), dr, 60);
                return [pts, this.createL(dx + (dr * 0.7), dy, dr, sp)];
            },

            createDLNP: function(dx, dy, dr, sp) {
                var pts = [];
                pts = this.createDD(dx - (dr * 5), dy, dr, sp);
                return [pts, this.createL(dx - (dr * 2.8), dy, dr, sp), this.createN(dx - (dr * 0.8), dy, dr, sp), this.createPP(dx + (dr * 0.8), dy, dr, sp)];
            },

            createLNP: function(dx, dy, dr, sp) {
                var pts = [];
                pts = this.createL(dx - (dr * 2.4), dy, dr, sp);
                return [pts, this.createN(dx - (dr * 0.5), dy, dr, sp), this.createPP(dx + (dr * 0.8), dy, dr, sp)];
            },


            createCLD: function(dx, dy, dr, sp) {
                var pts = [];
                pts = this.createCC(dx - (dr * 2.4), dy, dr, sp);
                return [pts, this.createL(dx - (dr * 1.3), dy, dr, sp), this.createDD(dx + (dr * 0.5), dy, dr, sp)];
            },

            createALD: function(dx, dy, dr, sp) {
                var pts = [];
                pts = this.createA(dx - (dr * 2.4), dy, dr, sp);
                return [pts, this.createL(dx - (dr * 1.3), dy, dr, sp), this.createDD(dx + (dr * 0.5), dy, dr, sp)];
            },

            createBHOL: function(dx, dy, dr, sp, map) {
                var pts = [];
                pts = this.createB(new Point(dx - (dr * 5), dy), dr, 60);
                //pts = this.createB(dx - (dr * 5),dy,dr,sp);
                return [pts, this.createH(dx - (dr * 2.8), dy, dr, sp, map), this.createO(dx - (dr * 0.8), dy, dr, sp), this.createL(dx + (dr * 0.8), dy, dr, sp)];
            },

            createDash: function(dx, dy, dr, sp) {
                var pts = [];
                pts.push(new Point(((dx) + (dx + (dr / 1.75))) / 2, ((dy + dr) + (dy - dr)) / 2, sp));
                pts.push(new Point(((dx - (dr / 1.75)) + (dx)) / 2, ((dy - dr) + (dy + dr)) / 2, sp));
                return pts;
            },



            createH: function(dx, dy, dr, sp, map) {
                var pts = [];
                /*
                pts.push(new Point(dx, dy-dr, sp));
                pts.push(new Point(dx, dy+dr, sp));
      
                pts.push(new Point(dx, dy+dr, sp));
      
                pts.push(new Point(dx, dy, sp));
                pts.push(new Point(dx+(dr*0.8), dy, sp));

                pts.push(new Point(dx+(dr*0.8), dy, sp));





                pts.push(new Point(dx, dy-dr, sp));  //Bottom Left
                pts.push(new Point(dx, dy+dr, sp));  //Top Left
                pts.push(new Point(dx, dy+dr, sp));  //Top Left
                pts.push(new Point(dx, dy, sp));   //Center
                pts.push(new Point(dx+(dr*0.8), dy, sp));  //Right Center


                */

                pts.push(new Point(dx - (dr / 1.5), dy - dr, sp)); //Bottom Left
                pts.push(new Point(dx - (dr / 1.5), dy + dr, sp)); //Top Left
                pts.push(new Point(dx - (dr * 0.7), dy, sp)); //Left Center
                pts.push(new Point(dx + (dr * 0.3), dy, sp)); //Right Center

                pts.push(new Point(dx + (dr / 4), dy - dr, sp));
                pts.push(new Point(dx + (dr / 4), dy + dr, sp));

                //pts.push(new Point(dx +(dr/1.5), dy+dr, sp));   //Top Right







                //GeoTools.displayPoint(map, new Point(dx +(dr/1.5), dy+dr, sp)); //Top Right









                /*
      
                //Left Hand
                pts.push(new Point(dx-(dr/1.5),dy-dr, sp));     
                pts.push(new Point(dx-(dr/1.5),dy+dr, sp));
                //Left Hand

                // Right Hand
                pts.push(new Point(dx+(dr/4),dy-dr, sp));     
                pts.push(new Point(dx+(dr/4),dy+dr, sp));
                // Right Hand

                pts.push(new Point(((dx)+(dx+(dr/1.75)))/2,((dy+dr)+(dy-dr))/2, sp));
                */


                /*
      
                //Dash
                pts.push(new Point(dx, dy, sp));
                pts.push(new Point(dx -dr, dy, sp));
                //Dash
                */



                /*
                pts.push(new Point(dx-(dr/1.5),dy-dr, sp));     
                pts.push(new Point(dx-(dr/1.5),dy+dr, sp));


                pts.push(new Point(((dx-(dr/1.75))+(dx))/2 ,((dy-dr)+(dy+dr))/2, sp));      
      
                pts.push(new Point(dx+(dr/4),dy-dr, sp));     
                pts.push(new Point(dx+(dr/4),dy+dr, sp));

                pts.push(new Point(((dx)+(dx+(dr/1.75)))/2,((dy+dr)+(dy-dr))/2, sp));
                */



                // pts.push(new Point(((dx)+(dx+(dr/1.75)))/2,((dy+dr)+(dy-dr))/2, sp));
                //pts.push(new Point(((dx-(dr/1.75))+(dx))/2 ,((dy-dr)+(dy+dr))/2, sp));

                return pts;

                /*
                var pts1 =[];
                var pts2 =[];
      
                pts1.push(new Point(dx-(dr/4),dy-dr, sp));     
                pts1.push(new Point(dx-(dr/4),dy+dr, sp));
      
                pts2.push(new Point(dx+(dr/4),dy-dr, sp));     
                pts2.push(new Point(dx+(dr/4),dy+dr, sp));
      
                return [pts1, pts2];
                */
            },




            createL: function(dx, dy, dr, sp) {
                var pts = [];
                pts.push(new Point(dx, dy - dr, sp));
                pts.push(new Point(dx, dy + dr, sp));

                pts.push(new Point(dx, dy - dr, sp));
                pts.push(new Point(dx + dr, dy - dr, sp));

                return pts;
            },



            createD: function(pt, radius, steps) {
                var paths = [];
                paths = paths.concat(this.createHalfCircle(pt, radius, 4.4, 2.0, 40));
                paths.push(new Point(pt.x - radius / 3, pt.y - radius));
                paths.push(new Point(pt.x - radius / 3, pt.y + radius));

                return paths;

            },

            createP: function(pt, radius, steps) {
                var paths = [];
                paths = paths.concat(this.createHalfCircle(new Point(pt.x - radius / 5.6, pt.y + radius / 2, pt.spatialReference), radius / 2, 4.4, 2, 40));
                paths.push(new Point(pt.x - radius / 3, pt.y - radius));
                paths.push(new Point(pt.x - radius / 3, pt.y + radius));
                return paths;

            },

            CATK: function(dx, dy, dr, sp) {
                var c = [];
                var a = [];
                var t = [];
                var k = [];
                c = this.createCC(dx - (dr * 1.67), dy, dr, sp); //1st 
                a = this.createA(dx - (dr * 0.5), dy, dr, sp);
                t = this.createT(dx + (dr * 0.83), dy, dr, sp);
                k = this.createK(dx + (dr * 1.83), dy, dr, sp);
                return [c, a, t, k];
            },


            createCC: function(dx, dy, dr, sp) {
                var pts = [];
                var step = 2 * Math.PI / 180;
                for (var dtheta = 65 * Math.PI / 180; dtheta < 295 * Math.PI / 180; dtheta += step) {
                    var x = dx + dr * Math.cos(dtheta);
                    var y = dy - dr * Math.sin(dtheta);
                    pts.push(new Point(x, y, sp));
                }
                return pts;
            },

            createG: function(dx, dy, dr, sp) {
                var pts = [];
                var pts2 = [];
                var step = 2 * Math.PI / 180;
                for (var dtheta = 65 * Math.PI / 180; dtheta < 295 * Math.PI / 180; dtheta += step) {
                    var x = dx + dr * Math.cos(dtheta);
                    var y = dy - dr * Math.sin(dtheta);
                    pts.push(new Point(x, y, sp));
                }

                var firstPt, lastPt, midPt, leg;
                firstPt = pts[0];
                lastPt = pts[pts.length - 1];
                midPt = GeoTools.getMidPoint(firstPt, lastPt);
                leg = new Point(midPt.x - (dr * 0.5), midPt.y, sp);
                pts2.push(firstPt);
                pts2.push(midPt);
                pts2.push(leg);

                return [pts, pts2];
            },




            createT: function(dx, dy, dr, sp) {
                var pts = [];

                pts.push(new Point(dx, dy - dr, sp)); //4
                pts.push(new Point(dx, dy + dr, sp)); //2

                pts.push(new Point(dx, dy + dr, sp)); //2
                pts.push(new Point(dx - (dr * 0.7), dy + dr, sp)); //1

                pts.push(new Point(dx, dy + dr, sp)); //1
                pts.push(new Point(dx + (dr * 0.7), dy + dr, sp)); //3

                return pts;
            },
            createJ: function(dx, dy, dr, sp) {
                var pts = [];
               
                pts.push(new Point(dx - (dr * 0.5), dy + dr, sp)); //1 //Left Arm    
                pts.push(new Point(dx + (dr * 0.5), dy + dr, sp)); //3 //Right Arm

                pts.push(new Point(dx, dy + dr, sp)); //2
                //pts.push(new Point(dx, dy - (dr / 20 ), sp)); //4 //Base of T
               

                //

                var stPt = new Point(dx, dy, sp);
                stPt = new Point(dx - (dr * 0.5), dy - (dr / 2), sp);
                pts = pts.concat(this.createHalfCircle(stPt, dr / 2, GeoTools.toRad(360), GeoTools.toRad(180), 30));
                                
                


                //pts = pts.concat(this.createHalfCircle(new Point(dx, dy - dr, sp), dr, GeoTools.toRad(360), GeoTools.toRad(180), 40));
                //pts = pts.concat(this.createHalfCircle(pts[3], dr, GeoTools.toRad(360), GeoTools.toRad(180), 40));

                return pts;
            },

            createA: function(dx, dy, dr, sp) {
                var pts = [];
                pts.push(new Point(dx - (dr / 1.75), dy - dr, sp)); //1
                pts.push(new Point(dx, dy + dr, sp)); //2
                pts.push(new Point(dx + (dr / 1.75), dy - dr, sp)); //3
                pts.push(new Point(((dx) + (dx + (dr / 1.75))) / 2, ((dy + dr) + (dy - dr)) / 2, sp));
                pts.push(new Point(((dx - (dr / 1.75)) + (dx)) / 2, ((dy - dr) + (dy + dr)) / 2, sp));
                return pts;
            },


            createAA: function(dx, dy, dr, sp) {
                var pts = [];
                pts = this.createA(dx - (dr * 1.3), dy, dr, sp);
                return [pts, this.createA(dx + (dr * 1.3), dy, dr, sp)];
            },


            createAO: function(dx, dy, dr, sp) {
                var pts = [];
                pts = this.createA(dx - (dr * 1.3), dy, dr, sp);
                return [pts, this.createO(dx + (dr * 1.3), dy, dr, sp)];
            },


            createUA: function(dx, dy, dr, sp) {
                var pts = [];
                pts = this.createU(dx - (dr * 1.3), dy, dr, sp);
                return [pts, this.createA(dx + (dr * 0.85), dy, dr, sp)];
            },


            createNAI: function(dx, dy, dr, sp) {
                var pts = [];
                pts = this.createN(dx - (dr * 1.3), dy, dr, sp);
                return [pts, this.createA(dx, dy, dr, sp), this.createI(dx + (dr * 0.8), dy, dr, sp)];
            },

            createTAI: function(dx, dy, dr, sp) {
                var pts = [];
                pts = this.createT(dx - (dr * 1.3), dy, dr, sp);
                return [pts, this.createA(dx, dy, dr, sp), this.createI(dx + (dr * 0.8), dy, dr, sp)];
            },


            createZOR: function(dx, dy, dr, sp) {
                var pts = [];
                pts = this.createZ(dx - (dr * 1.8), dy, dr, sp);
                return [pts, this.createO(dx, dy, dr, sp), this.createR(dx + (dr * 1.2), dy, dr, sp)];
            },

            createFAA: function(dx, dy, dr, sp) {
                var pts = [];
                pts = this.createF(dx - (dr * 1.8), dy, dr, sp);
                return [pts, this.createA(dx, dy, dr, sp), this.createA(dx + (dr * 1.2), dy, dr, sp)];
            },


            createFUP: function(dx, dy, dr, sp) {
                var pts = [];
                pts = this.createF(dx - (dr * 2.5), dy, dr, sp);
                return [pts, this.createU(dx, dy, dr, sp), this.createPP(dx + (dr * 1.7), dy, dr, sp)];
            },

            createDAA: function(dx, dy, dr, sp) {
                var pts = [];
                pts = this.createDD(dx - (dr * 1.8), dy, dr, sp);
                return [pts, this.createA(dx, dy, dr, sp), this.createA(dx + (dr * 1.2), dy, dr, sp)];
            },
            createOBJ: function(dx, dy, dr, sp) {
                var pts = [];
                pts = this.createO(dx - (dr * 1.5), dy, dr, sp);
                return [pts, this.createB(new Point(dx, dy), dr, 60), this.createJ(dx + (dr * 1.5), dy, dr, sp)];
            },
            createSAA: function(dx, dy, dr, sp) {
                var pts = [];
                pts = this.createS(dx - (dr * 1.6), dy, dr, sp);
                return [pts, this.createA(dx, dy, dr, sp), this.createA(dx + (dr * 1.6), dy, dr, sp)];
            },

            createDA: function(dx, dy, dr, sp) {
                var pts = [];
                pts = this.createDD(dx - (dr * 2), dy, dr, sp);
                return [pts, this.createA(dx, dy, dr, sp)];
            },

            createCAA: function(dx, dy, dr, sp) {
                var pts = [];
                pts = this.createCC(dx - (dr * 1.2), dy, dr, sp);
                return [pts, this.createA(dx, dy, dr, sp), this.createA(dx + (dr * 1.2), dy, dr, sp)];
            },

            createBAA: function(dx, dy, dr, sp) {
                var pts = [];
                pts = this.createB(new Point(dx - dr, dy), dr, 60);                
                return [pts, this.createA(dx, dy, dr, sp), this.createA(dx + (dr * 1.2), dy, dr, sp)];
            },


            createACP: function(dx, dy, dr, sp) {
                var pts = [];
                pts = this.createA(dx - (dr * 1.8), dy, dr, sp);
                return [pts, this.createCC(dx, dy, dr, sp), this.createPP(dx + (dr * 1.2), dy, dr, sp)];
            },

            createZ: function(dx, dy, dr, sp) {
                var pts = [];

                pts.push(new Point(dx, dy + dr, sp));
                pts.push(new Point(dx + dr, dy + dr, sp));

                pts.push(new Point(dx, dy - dr, sp));
                pts.push(new Point(dx + dr, dy - dr, sp));

                return pts;
            },

            createR: function(dx, dy, dr, sp) {
                var pts = [];

                pts = this.createDD(dx, dy + (dr / 2), dr / 2, sp);

                pts.push(new Point(dx - ((dr / 2) / 3), dy, sp));
                pts.push(new Point(dx - ((dr / 2) / 3), dy - dr, sp));

                pts.push(new Point(dx - ((dr / 2) / 3), dy, sp));
                pts.push(new Point(dx + (dr / 2), dy - dr, sp));

                return pts;
            },

            createK: function(dx, dy, dr, sp) {
                var pts = [];
                //line(dx, dy+dr, dx, dy-dr, ctr);
                pts.push(new Point(dx, dy + dr, sp));
                pts.push(new Point(dx, dy - dr, sp));


                //line(dx, dy, dx+(dr*0.8), dy+dr, ctx);
                pts.push(new Point(dx, dy, sp));
                pts.push(new Point(dx + (dr * 0.8), dy - dr, sp));

                //line(dx, dy, dx+(dr*0.8), dy-dr, ctx);
                pts.push(new Point(dx, dy, sp));
                pts.push(new Point(dx + (dr * 0.8), dy + dr, sp));
                return pts;

            },


            createS: function(dx, dy, dr, sp) {
                var pts = [];

                var step = 2 * Math.PI / 180;
                var ddr = dr / 2;


                pts.push(new Point(dx + (dr * 0.3), dy + dr, sp));
                pts.push(new Point(dx, dy + dr, sp));
                //var dtheta = 90*Math.PI/180;  dtheta < 270*Math.PI/180;  dtheta+=step
                for (var dtheta = 90 * Math.PI / 180; dtheta < 270 * Math.PI / 180; dtheta += step) {
                    var x = dx + ddr * Math.cos(dtheta);
                    var y = (dy + ddr) + ddr * Math.sin(dtheta); //note 2.
                    pts.push(new Point(x, y, sp));
                }



                for (var dtheta = 90 * Math.PI / 180; dtheta > 0 * Math.PI / 180; dtheta -= step) {
                    var x = dx + ddr * Math.cos(dtheta);
                    var y = (dy - ddr) + ddr * Math.sin(dtheta); //note 2.
                    pts.push(new Point(x, y, sp));
                }



                for (var dtheta = 360 * Math.PI / 180; dtheta > 270 * Math.PI / 180; dtheta -= step) {
                    var x = dx + ddr * Math.cos(dtheta);
                    var y = (dy - ddr) + ddr * Math.sin(dtheta); //note 2.
                    pts.push(new Point(x, y, sp));
                }

                //line(dx, dy-dr, dx-(dr*0.3), dy-dr, ctx);
                pts.push(new Point(dx, dy - dr, sp));
                pts.push(new Point(dx - (dr * 0.3), dy - dr, sp));


                return pts;
            },

            createO: function(dx, dy, dr, sp) {
                var pts = [];
                var step = 2 * Math.PI / 180;
                for (var dtheta = 0 * Math.PI / 180; dtheta < 360 * Math.PI / 180; dtheta += step) {
                    var x = dx + 0.5 * dr * Math.cos(dtheta);
                    var y = dy - dr * Math.sin(dtheta);
                    pts.push(new Point(x, y, sp));
                }
                return pts;
            },

            arrowHead: function(candidatePoint, length, angle) {
                var path = [];

                angle += 15;
                var angle1 = GeoTools.toDegrees(angle); // In Degrees
                angle -= 30;
                var angle2 = GeoTools.toDegrees(angle);


                var rightWing = new Point(candidatePoint.x + length * Math.cos(GeoTools.toRad(angle1)),
                    candidatePoint.y + length * Math.sin(GeoTools.toRad(angle1)), candidatePoint.spatialReference);

                var leftWing = new Point(candidatePoint.x + length * Math.cos(GeoTools.toRad(angle2)),
                    candidatePoint.y + length * Math.sin(GeoTools.toRad(angle2)), candidatePoint.spatialReference);

                path = path.concat(rightWing, candidatePoint, leftWing);
                return path;
            },
            arrowHeadBackward: function(candidatePoint, length, angle) {
                var path = [];
                angle += 100;
                var angle1 = GeoTools.toDegrees(angle); // In Degrees
                angle -= 30;
                var angle2 = GeoTools.toDegrees(angle);
                var rightWing = new Point(candidatePoint.x + length * Math.cos(GeoTools.toRad(angle1)),
                    candidatePoint.y + length * Math.sin(GeoTools.toRad(angle1)), candidatePoint.spatialReference);

                var leftWing = new Point(candidatePoint.x + length * Math.cos(GeoTools.toRad(angle2)), candidatePoint.y + length * Math.sin(GeoTools.toRad(angle2)), candidatePoint.spatialReference);

                path = path.concat(rightWing, candidatePoint, leftWing);


                return path;
            },
            CreateArrowHeadPathEx: function(pt1, candidatePt, pt2, totalLen, headPercentage, headAngle, straight) {
                //var headSizeBaseRatio = 1.7;
                var headSizeBaseRatio = 1.1;
                //set result = 0 to create single line arrow like -------->
                var headBaseLen = totalLen * headPercentage;


                var headSideLen = headBaseLen * headSizeBaseRatio;
                var angle1 = GeoTools.twoPtsAngle(candidatePt, pt1);
                var angle2 = GeoTools.twoPtsAngle(candidatePt, pt2);

                var midAngle = (Math.abs(angle1 - angle2)) / 2;
                if (Math.abs(angle1 - angle2) > Math.PI * 1.88) midAngle += Math.PI;
                var len = Math.sqrt(headBaseLen * headBaseLen + headSideLen * headSideLen - 2 * headSideLen * headBaseLen * Math.cos(midAngle + headAngle / 180 * Math.PI));
                var upAngle = Math.asin(headBaseLen * Math.sin(midAngle + headAngle / 180 * Math.PI) / len);
                var centAngle = upAngle + headAngle / 180 * Math.PI;
                var result;
                result = (straight == false || straight == undefined) ? (headBaseLen * Math.sin(Math.PI - centAngle - midAngle) / Math.sin(centAngle)) : 0;
                var path = [];

                path.push({
                    x: candidatePt.x + result * Math.cos(angle1),
                    y: candidatePt.y + result * Math.sin(angle1)
                });
                path.push({
                    x: candidatePt.x + headSideLen * Math.cos(angle1 - headAngle / 180 * Math.PI),
                    y: candidatePt.y + headSideLen * Math.sin(angle1 - headAngle / 180 * Math.PI)
                });
                path.push(candidatePt);
                path.push({
                    x: candidatePt.x + headSideLen * Math.cos(angle2 + headAngle / 180 * Math.PI),
                    y: candidatePt.y + headSideLen * Math.sin(angle2 + headAngle / 180 * Math.PI)
                });
                path.push({
                    x: candidatePt.x + result * Math.cos(angle2),
                    y: candidatePt.y + result * Math.sin(angle2)
                });
                return path;

            },

            CreateBezierPathPCOnly: function(pointCollection, numberOfPts) {
                var position = {
                    x: pointCollection[0].x,
                    y: pointCollection[0].y
                };
                if (pointCollection[pointCollection.length - 1].x === pointCollection[pointCollection.length - 2].x && pointCollection[pointCollection.length - 1].y === pointCollection[pointCollection.length - 2].y) {
                    pointCollection.pop();
                }
                if (pointCollection[pointCollection.length - 1].x === pointCollection[pointCollection.length - 2].x && pointCollection[pointCollection.length - 1].y === pointCollection[pointCollection.length - 2].y) {
                    pointCollection.pop();
                }
                //pointCollection.push(pt);
                var tween = TweenMax.to(position, numberOfPts, {
                    bezier: pointCollection,
                    ease: Linear.easeNone
                });
                //ease:Power1.easeInOut  ease: Linear.easeNone
                var path = [];
                for (var i = 0; i <= numberOfPts; i++) {
                    tween.time(i);
                    path.push({
                        x: position.x,
                        y: position.y
                    });
                }

                return path;

            },
            createI: function(dx, dy, dr, sp) {
                var pts = [];
                pts.push(new Point(dx, dy - dr, sp));
                pts.push(new Point(dx, dy + dr, sp));
                return pts;
            },
            createX: function(dx, dy, dr, sp) {
                var pts = [];
                pts.push(new Point(dx - (dr / 2), dy - dr, sp));
                pts.push(new Point(dx, dy, sp));
                pts.push(new Point(dx + (dr / 2), dy + dr, sp));
                pts.push(new Point(dx, dy, sp));
                pts.push(new Point(dx + (dr / 2), dy - dr, sp));
                pts.push(new Point(dx, dy, sp));
                pts.push(new Point(dx - (dr / 2), dy + dr, sp));
                return pts;
            },
            createW: function(dx, dy, dr, sp) {
                var pts = [];


                pts.push(new Point(dx - (dr * 0.7), dy - dr, sp));
                pts.push(new Point(dx - (dr * 0.7), dy + dr, sp));


                pts.push(new Point(dx - (dr * 0.7), dy - dr, sp));
                pts.push(new Point(dx, dy, sp));


                pts.push(new Point(dx, dy, sp));
                pts.push(new Point(dx + (dr * 0.7), dy - dr, sp));


                pts.push(new Point(dx + (dr * 0.7), dy - dr, sp));
                pts.push(new Point(dx + (dr * 0.7), dy + dr, sp));

                return pts;
            },


            createV: function(dx, dy, dr, sp) {
                var pts = [];

                pts.push(new Point(dx - (dr * 0.7), dy + dr, sp));
                pts.push(new Point(dx, dy - (dr * 0.9), sp));
                pts.push(new Point(dx + (dr * 0.7), dy + dr, sp));

                //GeoTools.displayPoint(map, pts[7], map.spatialReference);

                return pts;
            },

            createDD: function(dx, dy, dr, sp) {
                var pts = [];
                var step = 2 * Math.PI / 180;


                pts.push(new Point(dx - (dr / 3), dy + dr, sp));
                pts.push(new Point(dx, dy + dr, sp));

                for (var dtheta = 270 * Math.PI / 180; dtheta < 360 * Math.PI / 180; dtheta += step) {
                    var x = dx + dr * Math.cos(dtheta);
                    var y = dy - dr * Math.sin(dtheta);
                    pts.push(new Point(x, y, sp));
                }

                for (var dtheta = 0 * Math.PI / 180; dtheta < 91 * Math.PI / 180; dtheta += step) {
                    var x = dx + dr * Math.cos(dtheta);
                    var y = dy - dr * Math.sin(dtheta);
                    pts.push(new Point(x, y, sp));
                }


                pts.push(new Point(dx - (dr / 3), dy - dr, sp));
                pts.push(new Point(dx, dy - dr, sp));


                pts.push(new Point(dx - (dr / 3), dy - dr, sp));
                pts.push(new Point(dx - (dr / 3), dy + dr, sp));

                return pts;
            },
            createPP: function(dx, dy, dr, sp) {
                var pts = [];
                pts = this.createDD(dx, dy + (dr / 2), dr / 2, sp);
                pts.push(new Point(dx - ((dr / 2) / 3), dy, sp));
                pts.push(new Point(dx - ((dr / 2) / 3), dy - dr, sp));

                return pts;
            },


            createWP: function(dx, dy, dr, sp) {
                return [this.createW(dx - (dr * 0.5), dy, dr, sp), this.createPP(dx + (dr * 0.7), dy, dr, sp)];
            },



            createENY: function(dx, dy, dr, sp) {

                return [this.createE(dx - (dr * 1.667), dy, dr, sp), this.createN(dx + (dr * 0.083), dy, dr, sp), this.createY(dx + (dr * 1.38), dy, dr, sp)];
            },
            createE: function(dx, dy, dr, sp) {
                var pts = [];
                pts.push(new Point(dx, dy - dr, sp));
                pts.push(new Point(dx, dy + dr, sp));

                pts.push(new Point(dx, dy + dr, sp));
                pts.push(new Point(dx + dr, dy + dr, sp));

                pts.push(new Point(dx, dy + dr, sp));

                pts.push(new Point(dx, dy, sp));
                pts.push(new Point(dx + (dr * 0.8), dy, sp));

                pts.push(new Point(dx, dy, sp));

                pts.push(new Point(dx, dy - dr, sp));
                pts.push(new Point(dx + dr, dy - dr, sp));

                return pts;
            },

            createF: function(dx, dy, dr, sp) {
                var pts = [];
                pts.push(new Point(dx, dy - dr, sp));
                pts.push(new Point(dx, dy + dr, sp));

                pts.push(new Point(dx, dy + dr, sp));
                pts.push(new Point(dx + dr, dy + dr, sp));

                pts.push(new Point(dx, dy + dr, sp));

                pts.push(new Point(dx, dy, sp));
                pts.push(new Point(dx + (dr * 0.8), dy, sp));


                return pts;
            },

            createN: function(dx, dy, dr, sp) {
                var pts = [];

                pts.push(new Point(dx - (dr * 0.5), dy - dr, sp));
                pts.push(new Point(dx - (dr * 0.5), dy + dr, sp));

                pts.push(new Point(dx + (dr * 0.5), dy - dr, sp));
                pts.push(new Point(dx + (dr * 0.5), dy + dr, sp));

                return pts;
            },

            createU: function(dx, dy, dr, sp) {
                var pts = [];
                pts.push(new Point(dx + dr / 0.97, dy + dr, sp));
                pts = pts.concat(this.createHalfCircle(new Point(dx, dy, sp), dr, GeoTools.toRad(360), GeoTools.toRad(180), 40));
                pts.push(new Point(dx - dr, dy + dr / 0.97, sp));
                pts.push(pts[pts.length - 1]);
                return pts;
            },


            createY: function(dx, dy, dr, sp) {
                var pts = [];
                pts.push(new Point(dx, dy, sp));
                pts.push(new Point(dx, dy - dr, sp));

                pts.push(new Point(dx, dy, sp));
                pts.push(new Point(dx - (dr * 0.6), dy + dr, sp));

                pts.push(new Point(dx, dy, sp));
                pts.push(new Point(dx + (dr * 0.6), dy + dr, sp));
                return pts;
            },

            ownRotate: function(pointArray, centerX, centerY, rotateAngle) {

                var x = 0;
                var y = 1;
                // translate to world cordinate
                for (var i = 0; i < pointArray.length; i++) {
                    pointArray[i]["x"] -= centerX;
                }
                for (var i = 0; i < pointArray.length; i++) {
                    pointArray[i]["y"] -= centerY;
                }
                // rotation at angle
                for (var i = 0; i < pointArray.length; i++) {
                    var tX = pointArray[i]["x"];
                    var tY = pointArray[i]["y"];
                    pointArray[i]["x"] = tX * Math.cos(rotateAngle) - tY * Math.sin(rotateAngle);
                    pointArray[i]["y"] = tX * Math.sin(rotateAngle) + tY * Math.cos(rotateAngle);
                }
                //translation back
                for (var i = 0; i < pointArray.length; i++) {
                    pointArray[i]["x"] += centerX;
                }
                for (var i = 0; i < pointArray.length; i++) {
                    pointArray[i]["y"] += centerY;
                }
                return pointArray;
            },


            rotate: function(pointArray, centerX, centerY, rotateAngle) {

                var x = 0;
                var y = 1;
                var tX;
                var tY;

                for (var i = 0; i < pointArray.length; i++) {
                    pointArray[i]["x"] -= centerX;
                    pointArray[i]["y"] -= centerY;

                    tX = pointArray[i]["x"];
                    tY = pointArray[i]["y"];
                    pointArray[i]["x"] = tX * Math.cos(rotateAngle) - tY * Math.sin(rotateAngle);
                    pointArray[i]["y"] = tX * Math.sin(rotateAngle) + tY * Math.cos(rotateAngle);

                    pointArray[i]["x"] += centerX;
                    pointArray[i]["y"] += centerY;


                }




                return pointArray;
            },


            //Echelons

            createEchelon: function(ech, pt, radius, angle) {

                var result = [];
                switch (ech) {
                    case "12":
                        result = Echelons.createSQUAD(pt.x, pt.y, radius, pt.spatialReference);
                        break;
                    case "120":
                        result = Echelons.createHollowOval(pt.x, pt.y, radius, pt.spatialReference);
                        break;
                    case "13":
                        result = Echelons.createSECTION(pt.x, pt.y, radius, pt.spatialReference);
                        break;
                    case "14":
                        result = Echelons.createPLATOON(pt.x, pt.y, radius, pt.spatialReference);
                        break;
                    case "15":
                        result = Echelons.createCoy(pt.x, pt.y, radius, pt.spatialReference);
                        break;
                    case "16":
                        result = Echelons.createBn(pt.x, pt.y, radius, pt.spatialReference);
                        break;
                    case "17":
                        result = Echelons.createREGIMENT(pt.x, pt.y, radius, pt.spatialReference);
                        break;
                    case "18":
                        result = Echelons.createBRIGADE(pt.x, pt.y, radius, pt.spatialReference);
                        break;
                    case "21":
                        result = Echelons.createDIV(pt.x, pt.y, radius, pt.spatialReference);
                        break;
                    case "22":
                        result = Echelons.createCORPS(pt.x, pt.y, radius, pt.spatialReference);
                        break;
                    case "23":
                        //result = Echelons.createArmy(pt.x, pt.y, radius, pt.spatialReference);
                        break;
                    case "26":
                        result = Echelons.createComd(pt.x, pt.y, radius, pt.spatialReference);
                        break;
                }


                if (angle !== undefined) {
                    var paths = [];
                    for (var r = 0; r < result.length; r++) {
                        paths.push(this.rotate(result[r], pt.x, pt.y, angle));
                    }
                    return paths;
                } else {
                    return result;
                }
            }

            //End of Echelons







        };
    });