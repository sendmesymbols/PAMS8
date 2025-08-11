/** @module Echelons
* Common shapes
*@author Abdul Razak
*/

define(["esri/geometry/Polyline", "esri/geometry/Point", "MilSymbologyExt/GeoTools"], function(Polyline, Point, GeoTools){
    
    return {
          createSQUAD : function(dx, dy, dr, sp) {
          var pts = [];
          var newPts = [];

          var x, y, x1, y1;
          var step = 2*Math.PI / 180;
          for(var dtheta = 0*Math.PI/180;  dtheta < 360*Math.PI/180;  dtheta+=step)  { 
            var x = dx + dr*Math.cos(dtheta);
            var y = dy - dr*Math.sin(dtheta);   
            pts.push(new Point(x,y,sp));
          }

          //Hatch
          for(var i = 0, j = 180;  i < pts.length;  i++, j--)  { 
            newPts.push(new Point(pts[i].x,pts[i].y,sp));
            newPts.push(new Point(pts[j].x,pts[j].y,sp));
                 
          }
          pts = pts.concat(newPts);
          
          return [pts];    
        },

        createHollowOval : function(dx, dy, dr, sp) {
          var pts = [];
          
          var x, y, x1, y1;
          var step = 2*Math.PI / 180;
          for(var dtheta = 0*Math.PI/180;  dtheta < 360*Math.PI/180;  dtheta+=step)  { 
            var x = dx + 0.5 * dr*Math.cos(dtheta);
            var y = dy - dr*Math.sin(dtheta);   
            pts.push(new Point(x,y,sp));
          }

          return [pts];    
        },


      createSECTION : function(dx, dy, dr, sp) {
      var pts1 = [];
      var pts2 = [];

      var newPts1 = [];
      var newPts2 = [];
      
      var step = 2*Math.PI / 180;
      dx1 = dx-(dr/4)-dr;
      dx2 = dx+(dr/4)+dr;
      
      for(var dtheta = 0*Math.PI/180;  dtheta < 360*Math.PI/180;  dtheta+=step)  { 
        var x = dx1 + dr*Math.cos(dtheta);
        var y = dy - dr*Math.sin(dtheta);
        pts1.push(new Point(x,y,sp));
      }
      
      for(var dtheta = 0*Math.PI/180;  dtheta < 360*Math.PI/180;  dtheta+=step)  { 
        var x = dx2 + dr*Math.cos(dtheta);
        var y = dy - dr*Math.sin(dtheta);
        pts2.push(new Point(x,y,sp));
      }

      //Hatch
          for(var i = 0, j = 180;  i < pts1.length;  i++, j--)  { 
            newPts1.push(new Point(pts1[i].x,pts1[i].y,sp));
            newPts1.push(new Point(pts1[j].x,pts1[j].y,sp));

            newPts2.push(new Point(pts2[i].x,pts2[i].y,sp));
            newPts2.push(new Point(pts2[j].x,pts2[j].y,sp));
                 
          }
          pts1 = pts1.concat(newPts1);
          pts2 = pts2.concat(newPts2);



      return [pts1, pts2];
    },
    createPLATOON : function(dx, dy, dr, sp) {
      var pts1=[];
      var pts2=[];
      var pts3=[];

      var newPts1=[];
      var newPts2=[];
      var newPts3=[];

      var step = 2*Math.PI / 180;
      dx1 = dx-dr-(dr/2)-dr;
      dx2 = dx;
      dx3 = dx+dr+(dr/2)+dr;
      
      
      for(var dtheta = 0*Math.PI/180;  dtheta < 360*Math.PI/180;  dtheta+=step)  { 
        var x = dx1 + dr*Math.cos(dtheta);
        var y = dy - dr*Math.sin(dtheta);    //note 2.
        pts1.push(new Point(x,y,sp));
      }
      
      
      for(var dtheta = 0*Math.PI/180;  dtheta < 360*Math.PI/180;  dtheta+=step)  { 
        var x = dx2 + dr*Math.cos(dtheta);
        var y = dy - dr*Math.sin(dtheta);    //note 2.
        pts2.push(new Point(x,y,sp));
      }
      
      
      for(var dtheta = 0*Math.PI/180;  dtheta < 360*Math.PI/180;  dtheta+=step)  { 
        var x = dx3 + dr*Math.cos(dtheta);
        var y = dy - dr*Math.sin(dtheta);    //note 2.
        pts3.push(new Point(x,y,sp));
      }


       //Hatch
          for(var i = 0, j = 180;  i < pts1.length;  i++, j--)  { 
            newPts1.push(new Point(pts1[i].x,pts1[i].y,sp));
            newPts1.push(new Point(pts1[j].x,pts1[j].y,sp));

            newPts2.push(new Point(pts2[i].x,pts2[i].y,sp));
            newPts2.push(new Point(pts2[j].x,pts2[j].y,sp));

            newPts3.push(new Point(pts3[i].x,pts3[i].y,sp));
            newPts3.push(new Point(pts3[j].x,pts3[j].y,sp));
                 
          }
          pts1 = pts1.concat(newPts1);
          pts2 = pts2.concat(newPts2);
          pts3 = pts3.concat(newPts3);

      return [pts1, pts2, pts3];
    },

     createCoy : function (dx, dy, dr, sp) {
      var pts = [];
      pts.push(new Point(dx, dy-dr, sp));     
      pts.push(new Point(dx, dy+dr, sp));
      return [pts];
    },
     createBn : function(dx, dy, dr, sp) {
      var pts1 =[];
      var pts2 =[];
      
      pts1.push(new Point(dx-(dr/4),dy-dr, sp));     
      pts1.push(new Point(dx-(dr/4),dy+dr, sp));
      
      pts2.push(new Point(dx+(dr/4),dy-dr, sp));     
      pts2.push(new Point(dx+(dr/4),dy+dr, sp));
      
      return [pts1, pts2];
    },
    createREGIMENT : function(dx, dy, dr, sp) {
      var pts1 = [];
      var pts2 = [];
      var pts3 = [];
      pts1.push(new Point(dx-(dr/2),dy-dr, sp));     
      pts1.push(new Point(dx-(dr/2),dy+dr, sp));     
      
      pts2.push(new Point(dx,dy-dr, sp));      
      pts2.push(new Point(dx,dy+dr, sp));      
      
      pts3.push(new Point(dx+(dr/2),dy-dr, sp));     
      pts3.push(new Point(dx+(dr/2),dy+dr, sp));     
      
      return [pts1, pts2, pts3];
    },
     createBRIGADE : function(dx, dy, dr, sp) {
      var pts = [];
      pts = this.createX(dx, dy, dr, sp);
      return [pts];
    },
     createDIV : function(dx, dy, dr, sp) {
      var pts1 = [];
      var pts2 = [];
      var dx1 = dx-(dr*0.75);
      var dx2 = dx+(dr*0.75);
      
      
      pts1 = this.createX(dx1, dy, dr, sp);
      pts2 = this.createX(dx2, dy, dr, sp);
      return [pts1, pts2];
    },

    createComd : function(dx, dy, dr, sp) {
      var pts1 = [];
      var pts2 = [];
      var dx1 = dx-(dr*0.75);
      var dx2 = dx+(dr*0.75);
      
      
      pts1 = this.createPlus(dx1, dy, dr, sp);
      pts2 = this.createPlus(dx2, dy, dr, sp);
      return [pts1, pts2];
    },


     createCORPS : function(dx, dy, dr, sp) {
      var dx1 = dx-(dr*1.5);
      var dx2 = dx;
      var dx3 = dx+(dr*1.5);
      var pts1 = [];
      var pts2 = [];
      var pts3 = [];

      
      pts1 = this.createX(dx1, dy, dr, sp);
      pts2 = this.createX(dx2, dy, dr, sp);
      pts3 = this.createX(dx3, dy, dr, sp);
      return [pts1, pts2, pts3];
    },

 
    
 createX : function(dx, dy, dr, sp) {
      var pts =[];
      pts.push(new Point(dx-(dr/2), dy-dr, sp));
      pts.push(new Point(dx, dy, sp));
      pts.push(new Point(dx+(dr/2), dy+dr, sp));      
      pts.push(new Point(dx, dy, sp));
      pts.push(new Point(dx+(dr/2), dy-dr, sp));
      pts.push(new Point(dx, dy, sp));
      pts.push(new Point(dx-(dr/2), dy+dr, sp));
      return pts;
    },
    createPlus : function(dx, dy, dr, sp) {
      var pts =[];
      
      pts.push(new Point(dx, dy - dr , sp));     
      pts.push(new Point(dx, dy + dr , sp));

   
            
      pts.push(new Point(dx, dy, sp));
      pts.push(new Point(dx+(dr*0.7), dy, sp));


      pts.push(new Point(dx, dy, sp));
      pts.push(new Point(dx-(dr*0.7), dy, sp));





      return pts;
    }




    };
});