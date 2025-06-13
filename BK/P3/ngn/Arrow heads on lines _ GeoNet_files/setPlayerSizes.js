define([
    'jquery',
    './vars'
], function($, vars) {

    /**
     * Applies player sizing using the main continers video-base
     * and video-player and places all internal elements as 100% sizing
     *
     * @param newWidth (int)
     * @param newHeight (int)
     *
     */
    function setPlayerSizes(newWidth, newHeight) {
        var videoBase = $('.jive-video-base');
        var videoPlayer = videoBase.find(".jive-video-player");
        videoBase.width(newWidth);
        videoBase.height(newHeight);

        var width = "100%";
        var height = "100%";

        if(vars.fixedPlayerSize) {
            width = vars.fixedWidth;
            height = vars.fixedHeight;
        }
        videoPlayer.css("width", width);
        videoPlayer.css("height", height);
        videoPlayer.children().css("width", width);
        videoPlayer.children().css("height", height);
        videoPlayer.children().attr("width", width);
        videoPlayer.children().attr("height", height);
    }
    
    return setPlayerSizes;
});
