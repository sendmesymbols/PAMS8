/*
 * Copyright (C) 1999-2015 Jive Software. All rights reserved.
 *
 * This software is the proprietary information of Jive Software. Use is subject to license terms.
 */

define([
    'jiverscripts/oo/class',
    './models/admin_source',
    './views/admin_view'
], function(Class, NitroAdminSource, NitroAdminView) {
    return Class.extend(function (protect, _super) {

        this.init = function (options) {
            var main = this;
            this.options = options;

            this.nitroAdminSource = new NitroAdminSource(options);
            this.nitroAdminView = new NitroAdminView(options);

            this.nitroAdminView.addListener('nitroAdminLinkClicked', function (promise) {
                main.nitroAdminSource.loadNitroAdminConfig().addCallback(function (config) {
                    promise.emitSuccess(config);
                }).addErrback(function (error, status) {
                    console.log('got an error in main.js');
                    promise.emitError(error, status);
                });
            });
        };
    });
});
