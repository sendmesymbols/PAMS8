/*
 * Copyright (C) 1999-2015 Jive Software. All rights reserved.
 *
 * This software is the proprietary information of Jive Software. Use is subject to license terms.
 */

define([
    'jquery',
    'jiverscripts/conc/observable',
    'apps/shared/views/abstract_view',
    'soy!jive.nitro.challenges.challengeModal',
    'soy!jive.nitro.challenges.emptyRecentCompleters',
    'jquery-plugin/jquery.lightbox_me'
], function($, observable, AbstractView, Nitro, userService) {
    return AbstractView.extend(function (protect, _super) {

        observable(this);

        this.init = function (options) {
            this.options = options;

            var self = this;

            $("a.nitro-challenge-link").on('click', function (e) {
                e.preventDefault();

                var challengeName = $(this).data('challenge-name');
                self.showChallenge(challengeName);
            });
        };

        protect.showChallenge = function (challengeName) {
            var self = this;

            this.emitP('showChallenge', challengeName).addCallback(function (data) {
                $.each(data.recentCompleters, function (_, user) {
                    $.extend(user, {
                        id: user.jiveUserID,
                        prop: {
                            connections: {}
                        },
                        hideTooltip: true
                    });
                });

                data.recentCompleters = $.grep(data.recentCompleters, function (user) {
                    return user.enabled;
                });

                data.currentUserID = self.options.currentJiveUserID;

                var content = $(jive.nitro.challenges.challengeModal(data));

                var empty = content.find("#modal-challenges-everyone p.j-empty");
                if (empty.length > 0) {
                    empty.append(jive.nitro.challenges.emptyRecentCompleters());

                    content.find(".g-recently-completed").remove();
                }

                content.lightbox_me({
                    destroyOnClose: true,
                    centered: true
                });
            });
        };

    });
});
