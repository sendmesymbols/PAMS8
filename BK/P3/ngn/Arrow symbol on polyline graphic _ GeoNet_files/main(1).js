/*
 * Copyright (C) 1999-2015 Jive Software. All rights reserved.
 *
 * This software is the proprietary information of Jive Software. Use is subject to license terms.
 */

define([
    'jiverscripts/oo/class',
    './models/challenges_source',
    './views/challenges_view'
], function(Class, ChallengesSource, ChallengesView) {
    return Class.extend(function(protect, _super) {

        this.init = function(options) {
            this.options = options;

            this.view = new ChallengesView(options);
            this.source = new ChallengesSource(options);

            var main = this;

            this.view.addListener('showChallenge', function(challengeName, promise) {
                main.source.loadChallenge(challengeName).addCallback(function(data) {
                    promise.emitSuccess(data);
                }).addErrback(function(error, status) {
                    promise.emitError(error, status);
                });
            });
        };

    });
})
