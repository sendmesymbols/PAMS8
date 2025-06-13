(function() {
    var pluginBaseUrl = '/plugins/event-type-plugin/resources/script/';
    requirejs.config({
        paths: {
            'jquery.fullcalendar': pluginBaseUrl + 'vendor/fullcalendar',
            'jquery.color': pluginBaseUrl + 'vendor/jquery.color'
        },

        shim: {
            'jquery.fullcalendar':  ['jquery'],
            'jquery.color':         ['jquery']
        }
    });
}());
