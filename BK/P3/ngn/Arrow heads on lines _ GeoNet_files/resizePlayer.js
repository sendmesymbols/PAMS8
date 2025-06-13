define([
    'jquery',
    './defaults',
    './centerElement',
    './setPlayerSizes',
    './vars'
], function ($, defaults, centerElement, setPlayerSizes, vars) {

    var offsetPercentage = 95; //the percentage offset of player vs frame

    /**
     * Resizes the player based on its container dimensions.
     *
     */
    function resizePlayer(div) {
        if(vars.fixedPlayerSize || $('.j-responsive-sm').length>0) {
            centerElement($('.jive-video-base'), $(".jive-video-content"));
        } else {

            var videoContent, videoBase, currentContentWidth, currentContentHeight;
            
            if (div && $('#j-stream, #j-js-communications').length !== 0) {
                videoContent = $(div);
                videoBase = videoContent.parent();
                currentContentWidth = videoContent.find('img').width();
                currentContentHeight = videoContent.find('img').height();
            } else {
                videoBase = $('.jive-video-base');
                videoContent = $('.jive-video-content');
                currentContentWidth = videoContent.width();
                currentContentHeight = videoContent.height();
            }

            var newPlayerHeight = parseInt(offsetPercentage / 100 * currentContentHeight);
            var newPlayerWidth = parseInt(defaults.aspectRatio * newPlayerHeight);

            //lets make sure we stay within the offset percentage in widths
            if (newPlayerWidth >= currentContentWidth * offsetPercentage / 100) {
                newPlayerWidth = parseInt(currentContentWidth * offsetPercentage / 100);
                newPlayerHeight = parseInt(newPlayerWidth / defaults.aspectRatio);
            }

            //lets make sure we stay within the offset percentage in height
            if (newPlayerHeight >= currentContentHeight * offsetPercentage / 100) {
                newPlayerHeight = parseInt(currentContentHeight * offsetPercentage / 100);
                newPlayerWidth = parseInt(defaults.aspectRatio * newPlayerHeight);
            }

            setPlayerSizes(newPlayerWidth, newPlayerHeight);
            centerElement(videoBase, videoContent);
        }

        return { width: newPlayerWidth, height: newPlayerHeight };
    }

    return resizePlayer;
});
