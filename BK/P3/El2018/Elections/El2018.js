define(["dojo/_base/declare",
    "esri/geometry/Polygon"
    ],
    function (declare, Polygon) {

        var El2018 = declare(null, { declaredClass: "El2018",
            className : "El2018",
        constructor: function (gJSON) {           
            if(gJSON !== {}) {
                this.geoJSON = gJSON; 

            } else {
                console.error('GEOJSON can not be empty.');
            }
                     

        },


        start : function() {
            var result = [];
            var plygon;
            for (i = 0; i < this.geoJSON.features.length; i++){
                for(var j = 0; j < this.geoJSON.features[i].geometry.coordinates.length; j++) {
                    
                    result.push({'geometry': new Polygon(this.geoJSON.features[i].geometry.coordinates), 
                        'properties': this.geoJSON.features[i].properties});
                }
            }
            
            return result;

        }

        });
        return El2018;
    }); 


