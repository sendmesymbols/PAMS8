/*
 * Copyright (C) 1999-2015 Jive Software. All rights reserved.
 *
 * This software is the proprietary information of Jive Software. Use is subject to license terms.
 */

define([
    'jquery',
    'underscore',
    'apps/shared/models/rest_service',
    '../../../jive-nitro',
    '../../shared/models/userService',
    'jiverscripts/conc/promise',
    '../../../lib/n4jive/n4jive.core'
], function($, _, RestService, JiveNitro, UserService, Promise, n4jive) {
    return RestService.extend(function (protect, _super) {

        this.init = function (options) {
            _super.init.call(this, options);
            this.options = options;
        };

        this.loadStatusLevels = function (jiveUserIDs) {
            var promise = new Promise();
            var userService = new UserService({});
            var self = this;

            userService.getUserIDs(jiveUserIDs).done(function (userIDs) {
                self.loadStatusFromNitro(userIDs, promise);
            });

            return promise;
        };

        protect.loadStatusFromNitro = function (userIDs, promise) {
            var self = this;
            var nitro = new JiveNitro(this.options);
            var locale = n4jive.locale(this.options.localizationEnabled);

            nitro.addMethod('user.getLevel', n4jive.extendWithLocale({
                userIds: _.values(userIDs).join(',')
            }, locale));

            nitro.execute(function (res) {
                self.handleNitroResponse(res, userIDs, promise);
            });
        };

        this.handleNitroResponse = function (res, userIDs, promise) {
            var nitro = res.Nitro;

            $.each(nitro.Nitro, function (i, method) {
                if (method.method === "user.getLevel") {
                    var users = {};

                    $.each($.makeArray(method.users.User), function (j, user) {
                        users[user.userId] = user.SiteLevel;
                    });

                    $.each(userIDs, function (jiveUserID, userID) {
                        users[userID].jiveUserID = jiveUserID;
                    });

                    promise.emitSuccess(users);
                }
            });
        };
    });
});
