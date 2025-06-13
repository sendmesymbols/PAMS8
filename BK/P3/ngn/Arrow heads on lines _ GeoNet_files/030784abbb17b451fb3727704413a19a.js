require([
    'plugins/gamification/resources/script/apps/admin/main',
    'domReady!'
], function(NitroAdmin) {
    new NitroAdmin({});
});

;
(function() {
    var pluginBaseUrl = '/plugins/event-type-plugin/resources/script/';
    requirejs.config({
        paths: {
            'jquery.fullcalendar': pluginBaseUrl + 'vendor/fullcalendar',
            'jquery.autocomplete': pluginBaseUrl + 'vendor/jquery.autocomplete',
            'jquery.color': pluginBaseUrl + 'vendor/jquery.color'
        },

        shim: {
            'jquery.fullcalendar':  ['jquery'],
            'jquery.autocomplete':  ['jquery'],
            'jquery.color':         ['jquery']
        }
    });
}());

;
require([
    'jquery',
    'apps/shared/controllers/localexchange',
    'plugins/video/resources/script/defaults',
    'plugins/video/resources/script/vars',
    'plugins/video/resources/script/centerElement',
    'plugins/video/resources/script/resizePlayer',
    'plugins/video/resources/script/videomacro',
    'jive/namespace',
    'domReady!'
], function($, localExchange, defaults, vars, centerElement, resizePlayer, videomacro) {
    /**
     * Detects resizing of the widow to adjust video player sizes
     */
    function detectResize() {
        $(window).resize(function(){
            if (vars.enableAutoResize) {
                resizePlayer();
            }
        });
    }

    /**
     * Applies default sizing for main video view page
     * such that all loads start with the same width and height
     * dimensions.
     */
    function applyDefaultSizing() {
        $('.jive-video-base').width(defaults.width).height(defaults.height);
        centerElement($('.jive-video-base'), $(".jive-video-content"));
    }

    ////////////////////////////////////////////////////////////////////////////////
    //
    //      Main Init to start the Video Player System
    //
    ////////////////////////////////////////////////////////////////////////////////
    /**
     * defines a simple Macro interface to mimic the RenderMacro class on the server
     */
    jive.namespace('rte.plugin');
    jive.rte.plugin.videomacro = videomacro;

    localExchange.addListener("renderedContentWithSelector", function ($renderedContent, opts) {
        require([
            'plugins/video/resources/script/getVideoDataAndRender'
        ], function(getVideoDataAndRender) {
            // bind to app artifacts in the RTE (RTE itself need not necessarily be visible). So any rendered content.
            $renderedContent.find('div.jive-content-video[data-video-id]').each(function (index, element) {
                var $element = $(element);

                if ($element.attr('data-video-id') && !$element.attr('data-video-rendered')) {

                    // TODO move it to videos's specific source.js maybe so it's a real MVC and subclasses RestService
                    // get the object data and add the auth token
                    var objectType = $element.attr('data-object-type');
                    var objectID = $element.attr('data-object-id');
                    var videoID = $element.attr('data-video-id');
                    var divID = $element.attr("id");
                    $element.attr("data-video-rendered", "true");
                    getVideoDataAndRender(divID, videoID, objectType, objectID);
                }
            });
        });
    });

    applyDefaultSizing();
    detectResize();
    resizePlayer();
});

;
