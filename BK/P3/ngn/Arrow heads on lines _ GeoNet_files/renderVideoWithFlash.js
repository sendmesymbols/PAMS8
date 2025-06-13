define([
    'jquery',
    './defaults',
    './vars',
    './resizePlayer',
    './globals',
    'soy!jive.videos.common.noFlash',
    'soy!jive.videos.i18n.keys.videoEncodingText'
], function($, defaults, vars, resizePlayer) {

    function renderVideoWithFlash(divID, video) {

        var videoID = video.externalID ? "" + video.externalID : '';
        var movie = video.playerBaseURL + '/plugins/player.swf?v=' + videoID + '&auth_token=' + video.authtoken + '&p=' + video.playerName;
        var base = video.playerBaseURL;
        var autoplay = video.autoplay;
        vars.lastAutoplay = autoplay;
        var src = video.playerBaseURL + '/plugins/player.swf?p=' + video.playerName + '&auth_token=' + video.authtoken;
        var watermark = video.watermarkURL ? video.watermarkURL : '';
        vars.lastWatermark = watermark;
        var player = resizePlayer();
        var width = player.width || Math.min(video.width, defaults.width);
        var height = player.height || Math.min(video.height, defaults.height);

        var $div, $parent_div;

        if (divID) {
            $div = $('#' + divID);
        }
        // if no div then should create one and lightbox me
        else {
            $div = $('<div id="as-video-container" class="media { type:\'swf\' }"></div>');
            $parent_div = $('<div id="lb_image_wrapper" class="jive-modal"><a class="j-modal-close-top close j-icon-close" href="#"><span class="j-close-icon j-ui-elem" role="img"></span></a></div>');
            $parent_div.append($div);
            $('body').append($parent_div);
        }

        if ($div.find('object').length > 0) {
            return;
        }

        if ($div.closest('#j-stream, #j-js-communications').length > 0) {
            width = $div.find('img').width() || video.width;
            height = $div.find('img').height() || video.height;
        }

        require(['jquery-plugin/jquery.media'], function() {
            var div = $div.media({
                width:     width,
                height:    height,
                flashVersion: '9.0.115.0',
                autoplay: autoplay,
                src:  src,
                attrs:     { id: 'embedded_player', tabindex: '0' },  // object/embed attrs
                params:    {
                    allowscriptaccess: 'always',
                    allowfullscreen: 'true',
                    movie: movie,
                    base: base,
                    bgColor: '#000000',
                    quality: 'high',
                    wmode: 'opaque'
                }, // object params/embed attrs
                flashvars: {
                    v:'0',
                    video_http_url: base,
                    autoplay: autoplay,
                    config: '{config:{autoplay:' + autoplay + '}}' ,
                    l:'[{video_id:\'' + videoID +'\',logo_file:\''+ watermark + '\'}]'
                },
                caption: false // suppress caption text
            });

            if (div.find('object').length == 0) {
                $div.after(jive.videos.common.noFlash());
            }
            resizePlayer(div);
        });
    }
    
    return renderVideoWithFlash;
});
