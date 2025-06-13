/*
 * Copyright (C) 1999-2015 Jive Software. All rights reserved.
 *
 * This software is the proprietary information of Jive Software. Use is subject to license terms.
 */

define([
    'jquery',
    'url',
    'apps/shared/models/rest_service'
], function($, url, RestService) {

    return RestService.extend(function(protect, _super) {

        this.init = function(options) {
            _super.init.call(this, options);
            this.options = options;
        };

        this.getProfileInfo = function(options) {
            var success = options.success;
            var error = options.error;

            delete options.success;
            delete options.error;

            $.ajax({
                url: url.v2Url("/nitro/users/data"),
                data: options,
                success: success,
                error: error
            });
        };

        this.getUserIDs = function(jiveUserIDs) {
            var dfd = new $.Deferred();
            var self = this;

            $.ajax({
                url: url.v2Url("/nitro/users/ids"),
                data: {
                    userId: jiveUserIDs
                },
                success: function(response) {
                    dfd.resolveWith(self, [response]);
                },
                error: function(jqXHR, textStatus, errorThrown) {
                    console.log('Error getting userIds: '+textStatus+'/'+errorThrown);
                    dfd.rejectWith(self, [textStatus, errorThrown]);
                }
            });

            return dfd;
        };

    });
});
