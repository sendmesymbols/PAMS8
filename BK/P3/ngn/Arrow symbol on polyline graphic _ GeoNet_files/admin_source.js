/*
 * Copyright (C) 1999-2015 Jive Software. All rights reserved.
 *
 * This software is the proprietary information of Jive Software. Use is subject to license terms.
 */

define([
	'jquery',
	'url',
	'apps/shared/models/rest_service',
    'jiverscripts/conc/promise',
    'jive/json-security'
], function($, urlUtils, RestService, Promise) {
    return RestService.extend(function(protect, _super) {
        protect.init = function(options) {
            this.options = options;
        };

        this.loadNitroAdminConfig = function() {
            var promise = new Promise();
            var error = this.errorFinding;
            var url = urlUtils.v2Url("/nitro/admin/config");

            $.ajax({
                url: url,
                type: "GET",
                contentType: "application/json; charset=utf-8",
                dataType: "json",
                success: function(data) {
                    promise.emitSuccess(data);
                },
                error: this.errorCallback(promise, error)
            });

            return promise;
        };
    });
});
