/*
 * Copyright (C) 1999-2015 Jive Software. All rights reserved.
 *
 * This software is the proprietary information of Jive Software. Use is subject to license terms.
 */

define([
    'jquery',
    'jiverscripts/conc/observable',
    'apps/shared/models/rest_service',
    '../../../jive-nitro',
    '../../shared/models/userService'
], function($, observable, RestService, JiveNitro, UserService) {
    return RestService.extend(function (protect, _super) {

        observable(this);

        this.init = function (options) {
            _super.init.call(this, options);
            this.options = options;
        };

        this.loadChallenge = function (challengeName) {
            var self = this;
            var nitro = new JiveNitro(this.options);
            var locale = n4jive.locale(nitro.connectionParams.localizationEnabled);

            nitro.addMethod('user.getChallengeProgress', n4jive.extendWithLocale({
                userId: this.options.userID,
                challengeName: challengeName
            }, locale));

            nitro.addMethod('site.getRecentChallenges', n4jive.extendWithLocale({
                userId: this.options.userID,
                challengeName: challengeName,
                trophiesOnly: true,
                returnCount: 6
            }, locale));

            return nitro.execute(function (res, promise) {
                self.handleResponse(res, promise);
            });
        };

        protect.handleResponse = function (res, promise) {
            var challenge = null;
            var userIDs = [];
            var userService = new UserService({});

            res.eachMethod('user.getChallengeProgress', function (method) {
                if (method.challenges !== true) {
                    challenge = method.challenges.Challenge;
                }
            });

            res.eachMethod('site.getRecentChallenges', function (method) {
                if (method.challenges !== true) {
                    $.each($.makeArray(method.challenges.Challenge), function (_, data) {
                        if ($.inArray(data.userId, userIDs) === -1) {
                            userIDs.push(data.userId);
                        }
                    });
                }
            });

            if (userIDs.length > 0) {
                userService.getProfileInfo({
                    userId: userIDs,
                    success: function (data) {
                        promise.emitSuccess({
                            recentCompleters: data.Users,
                            challenge: challenge
                        });
                    },
                    error: function (error, message) {
                        promise.emitError(error, message);
                    }
                });
            }
            else {
                promise.emitSuccess({
                    recentCompleters: [],
                    challenge: challenge
                });
            }

        };

    });
});
