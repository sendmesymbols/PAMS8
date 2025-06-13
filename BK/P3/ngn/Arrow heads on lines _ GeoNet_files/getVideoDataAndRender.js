define([
    'jquery',
    'url',
    './constants',
    './defaults',
    './vars',
    './renderVideo',
    './resizePlayer'
], function($, urlUtil, constants, defaults, vars, renderVideo, resizePlayer) {

    function videoResultHandler(divID, video) {
        if (!video.hasOwnProperty("videoType") || video.videoType === constants.VIDEO_PERCEPTIVE_TYPE) {
            loadPerceptiveVideo(divID, video);
        } else if (video.videoType === constants.VIDEO_EMBEDDED_TYPE) {
            loadEmbeddedVideo(divID, video);
        }
    }

    /**
     * Applies a set of width and height dimensions to an
     * element that's been passed in. Used when we need to load
     * players with a specific width and height requirement.
     *
     * @param element (object)
     * @param width (int)
     * @param height (int)
     *
     */
    function applyElementSizing(element, width, height) {
        var mainElement = $(element);
        mainElement.attr("width", width+"px");
        mainElement.attr("height", height+"px");
        var embedChildren = mainElement.children(); //get all the child elements
        for (var i = 0; i < embedChildren.length; i++) {
            var childElement = embedChildren[i];
            var tagName = childElement.tagName.toLowerCase();
            if (tagName == "iframe" || tagName == "object" || tagName == "embed") {
                $(childElement).attr("width", width+"px");
                $(childElement).attr("height", height+"px");
            }
        }
    }

    /**
     * Displays the video player and hides all
     * other elements from view.
     */
    function showVideoPlayerElements() {
        $(".jive-video-poster").hide();
        $(".jive-video-base").show();
        $(".jive-video-player").show();
        $(".jive-video-message").hide();
    }

    function insertVideoElement(divID, videoElement, setSizes, setWidth, setHeight) {
        if (divID) {  // load up the on-page player
            var $videoDiv = $('#' + divID);
            $('#' + divID).empty().append(videoElement).show();
            if (vars.fixedPlayerSize) {
                setFixedPlayerSizes(vars.fixedWidth, vars.fixedHeight);
            } else {
                if (setSizes) applyElementSizing(videoElement, setWidth, setHeight);
            }
            showVideoPlayerElements();
            // remove event handlers and thumbnail
            $videoDiv.off().removeClass('j-tile-video-thumb');
            resizePlayer();
        }
        else { // load up the lightbox player
            var element = $('<div id="as-video-container" class="media { type:\'swf\' }"><div class="jive-video-base"><div class="jive-video-player" id="jive-video-display"></div></div></div>');
            $parent_div = $('<div id="lb_image_wrapper" class="jive-modal"><a class="j-modal-close-top close j-icon-close" href="#"><span class="j-close-icon j-ui-elem" role="img"></span></a></div>');
            $parent_div.append(element);
            $('body').append($parent_div);

            if(vars.fixedPlayerSize) {
                element.width(vars.fixedWidth).height(vars.fixedHeight);
            } else {
                element.width(defaults.width).height(defaults.height);
            }

            vars.enableAutoResize = false;

            $parent_div.lightbox_me({
                destroyOnClose: true,
                onClose: function() {
                    $('#lb_image_wrapper').remove();
                },
                modalCSS : {top:'160px'},
                closeSelector: ".jive-modal-close-top, .close",
                onLoad: function() {
                    showVideoPlayerElements();
                    $(".jive-video-base").css("display", "block");
                    $("#jive-video-display").append(videoElement).show().focus();
                    if(vars.fixedPlayerSize) {
                        setPlayerSizes(vars.fixedWidth, vars.fixedHeight);
                    } else {
                        setPlayerSizes("100%", "100%");
                    }
                }
            });
        }
    }

    /**
     * Sets a fixed player width and height
     * duplicated from upload-file-only.ftl
     * @param width (int)
     * @param height (int)
     *
     */
    function setFixedPlayerSizes(width, height) {
        fixedPlayerSize = true;
        setPlayerSizes(width, height);
        centerElement($('.jive-video-base'), $(".jive-video-content"));
    }

    /**
     * Applies player sizing using the main continers video-base
     * and video-player and places all internal elements as 100% sizing
     * duplicated from upload-file-only.ftl
     * @param newWidth (int)
     * @param newHeight (int)
     *
     */
    function setPlayerSizes(newWidth, newHeight) {
        var videoBase = $('.jive-video-base');
        var videoPlayer = $(".jive-video-player");
        videoBase.width(newWidth);
        videoBase.height(newHeight);
        videoPlayer.css("width", "100%");
        videoPlayer.css("height", "100%");
        //videoPlayer.children().css("width", videoPlayer.width());
        //videoPlayer.children().css("height", videoPlayer.height());
        //videoPlayer.children().attr("width", videoPlayer.width());
        //videoPlayer.children().attr("height", videoPlayer.height());
    }

    /**
     * Used by the main video view page to center the player
     * within the dark viewer backdrop. Ignored on other
     * player view profiles.
     *
     * duplicated from upload-file-only.ftl
     */
    function centerElement(element, parent){
        var newTop = parseInt( (parent.height() - element.height())/2);
        var newLeft = parseInt( (parent.width() - element.width())/2);
        element.css('top', newTop+"px");
        element.css('left', newLeft+"px");
    }

    function loadPerceptiveVideo(divID, video) {
        renderVideo(divID, video);
        showVideoPlayerElements();
        resizePlayer('#' +divID); //resize me
    }

    function loadEmbeddedVideo(divID, video) {
        var setSizesOrig = video.setSizes;
        var widthOrig = video.width;
        var $videoLink = $('#' + divID);
        if (video.videoSource.match(/data-showshare-player/)) {
            if(video.setSizes && video.width == 440) { //this is an activity stream video
                video.width = vars.fixedWidth = "440";
                video.height = vars.fixedHeight = "299";
            }
            else if (divID.match(/video-tile/)) {
                video.width = vars.fixedWidth = $videoLink.children('img').width();
                video.height = vars.fixedHeight = $videoLink.children('img').height();
            }
            else {
                video.width = vars.fixedWidth = "747";
                video.height = vars.fixedHeight = "470.1875";
            }
            vars.fixedPlayerSize = true;
            video.setSizes = false;
        }

        var iframe = '<iframe src="video-player.jspa?'
            + 'autoplay=' + video.autoplay
            + '&mediaID=' + video.videoID
            + '&vars.fixedPlayerSize=' + vars.fixedPlayerSize
            + '&setSizes=' + setSizesOrig
            + '&width=' + widthOrig
            + '"'
            + ' frameborder="0" height="' + video.height + '" width="' + video.width + '" '
            + ' id="mediaFrame" name="mediaFrame" allowTransparency="true" tabIndex="0" allowfullscreen></iframe>';
        insertVideoElement(divID, iframe, video.setSizes, video.width, video.height);
    }

    /**
     * ObjectID and ObjectType are for the object the video is embedded into
     * for permission checking purposes but
     * in case of the video rendering itself, it's the same as video
     *
     * @param divID
     * @param videoID
     * @param objectType
     * @param objectID
     * @param width
     * @param height
     * @param autoplay
     */
    function getVideoDataAndRender(divID, videoID, objectType, objectID, width, height, autoplay) {

        var url = urlUtil.v2Url("/videos");

        if(vars.videos && vars.videos[videoID] != null) {  // load up our existing video to save another call to the server
            videoResultHandler(divID, vars.videos[videoID]); // use new video player for main videos
            return;
        }

        $.ajax({
            type: "GET",
            url: url + "/" + videoID + "?objectType=" + objectType + "&objectID=" + objectID,
            success: function(video) {
                if (video.authtoken) {
                    video.videoID = videoID;

                    if (width !== undefined) {
                        if (video) {
                            video.width = width;
                            video.setSizes = true; //tells the loader to hard set sizes
                        }
                    }

                    if (height !== undefined) {
                        if(video) video.height = height;
                    }

                    if (autoplay !== undefined) {
                        if(video) video.autoplay = autoplay;
                    }

                    vars.videos[video.videoID] = video; //collect all the videos in this page for storing
                    videoResultHandler(divID, video); //use new video player for main videos
                }
            }
        });
    }

    return getVideoDataAndRender;
});
