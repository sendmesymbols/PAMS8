/*
 * Copyright (C) 1999-2015 Jive Software. All rights reserved.
 *
 * This software is the proprietary information of Jive Software. Use is subject to license terms.
 */

define([
    'jquery',
    'jiverscripts/oo/class',
    './models/content_source',
    './views/content_view',
    'jive/rte/renderedContent',
    'apps/shared/controllers/localexchange'
], function($, Class, ContentSource, ContentView, renderedContent, localexchange) {

    return Class.extend(function () {

        this.init = function (options) {
            this.options = options;
            this.source = new ContentSource(options);
            this.view = new ContentView(options);

            var main = this;

            localexchange.addListener("renderedContent", function (container) {
                var id = $(container).attr('id');
                if (container && ("jive-comments" === id || "jive-thread-messages-container" == id)) {
                    main.loadStatusLevels();
                }
            });

            this.view.addListener('viewReady', $.proxy(this.loadStatusLevels, this));
        };

        this.loadStatusLevels = function () {
            var main = this;

            main.source.loadStatusLevels(main.view.getUserIDs()).addCallback(function (users) {
                main.view.showStatusLevels(users);
                localexchange.emit("nitro.content.userStatusLoaded");
            });
        };

    });
});
