define([
    'jquery',
    './defaults',
    './renderVideoWithFlash',
    './resizePlayer',
    'soy!jive.videos.i18n.keys.videoEncodingText',
    'jquery-plugin/jquery.lightbox_me'
], function ($, defaults, renderVideoWithFlash, resizePlayer) {

    function isFlashEnabled() {
        if (navigator.mimeTypes["application/x-shockwave-flash"] !== undefined) {
            return true;
        }
        var flashObj = null;
        try {
            flashObj = new ActiveXObject('ShockwaveFlash.ShockwaveFlash');
        }
        catch (ex) {
            return false;
        }
        if (flashObj != null) {
            return true;
        }
    }

    /**
     * @param divID
     * @param video
     */
    function renderVideo(divID, video) {

        if (!video.transcoded && !video.embedded) {
            var $warningDiv = $(
                '<div class="jive-video-encode-box">' +
                '<div class="jive-video-message-large">' + jive.videos.i18n.keys.videoEncodingText() + '</div>' +
                '<div class="jive-video-encode-icon"></div>' +
                '</div>');

            $('#' + divID).prepend($warningDiv);
            return;
        }

        if (isFlashEnabled() && !video.html5Enabled) {
            renderVideoWithFlash(divID, video);
            return;
        }

        var videoID = video.externalID ? '' + video.externalID : '';
        var player = resizePlayer();
        var width = player.width || Math.min(video.width, defaults.width);
        if ($('#j-stream, #j-js-communications').length === 0) {
            width = Math.min(width, $('.jive-video-base').width() - 10)
        }

        var height = player.height || Math.min(video.height, Math.round(width / defaults.aspectRatio));
        var $div = $('#' + divID);
        var $parent_div;

        if ($div.closest('#j-stream, #j-js-communications').length > 0) {
            width = Math.min($div.find('img').width(), width);
            height = Math.min($div.find('img').height(), width);
        }

        $('.jive-video-content').height(height + 50);

        // Twistage JS won't work because header_javascript.ftl blocks document.write calls
        // so use iFrame to host the video and still use their code
        var $vidContents = $('<iframe width="' + (width + 25) + '" height="' + (height + 25) + '" id="iframe_' +
            videoID + '">');

        // Swap out video and placeholder image
        $div.find('img').replaceWith($vidContents);

        if ($vidContents[0].contentWindow == null) {
            $div.replaceWith($vidContents);
        }

        var doc = ($vidContents[0].contentWindow || $vidContents[0].contentDocument);
        if (doc.document) {
            doc = doc.document;
        }

        var script = doc.createElement('script');
        script.type = 'text/javascript';
        script.src = video.playerBaseURL + '/api/script';
        var head = doc.getElementsByTagName('head')[0];

        script.onload = script.onreadystatechange = function () {
            if (!doc.readyState || doc.readyState == "loaded" || doc.readyState == "complete") {
                var s = doc.createElement('script');
                s.type = 'text/javascript';
                s.text = 'viewNode(\'' + videoID + '\',{ server_detection: true, width: ' + width + ', height: ' +
                    height
                    + ', player_profile:\'' + video.playerName + '\', auth_token:\'' + video.authtoken + '\'});';
                head.insertBefore(s, head.firstChild);
            }
        };

        head.insertBefore(script, head.firstChild);
    }

    return renderVideo;
});
