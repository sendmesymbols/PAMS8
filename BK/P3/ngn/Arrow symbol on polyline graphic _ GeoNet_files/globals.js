define([
  './vars'
], function(vars) {

    window.getAutoplay = function(videoId){
        if (vars.videos[videoId] && vars.videos[videoId].autoplay != null) {
            return vars.videos[videoId].autoplay;
        }
        return vars.lastAutoplay;
    };

    window.getWatermarkUrl = function(videoId){
        if(vars.videos[videoId] && vars.videos[videoId].watermarkURL != null) {
            return vars.videos[videoId].watermarkURL;
        }
        return vars.lastWatermark;
    };

    window.useVideoConfig = function() {
        return true;
    };
    
});
