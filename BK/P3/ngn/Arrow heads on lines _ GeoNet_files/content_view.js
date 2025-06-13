/*
 * Copyright (C) 1999-2015 Jive Software. All rights reserved.
 *
 * This software is the proprietary information of Jive Software. Use is subject to license terms.
 */

define([
    'jquery',
    'jiverscripts/conc/observable',
    'apps/shared/views/abstract_view',
    'soy!jive.ps.nitro.content.statusLevelImage',
    'jquery-plugin/jquery.lightbox_me'
], function($, observable, AbstractView) {
    return AbstractView.extend(function (protect, _super) {

        observable(this);

        this.init = function (options) {
            this.options = options;
            var view = this;

            $(function () {
                view.emit('viewReady');
            });

        };

        this.showStatusLevels = function (users) {
            $(".jive-comment a.j-avatar, div.j-post-avatar a.j-avatar").each(function (i, link) {
                var jiveUserID = $(link).data('userid');

                $.each(users, function (userID, user) {
                    if (jiveUserID == user.jiveUserID) {
                        $(link).append(jive.ps.nitro.content.statusLevelImage({
                            imagePath: user.iconUrl,
                            title: user.name
                        }));
                    }
                });
            });
        };


        this.getUserIDs = function () {
            var userIDs = [];

            $("a.j-avatar, div.j-post-avatar a.j-avatar").each(function (i, link) {
                var userID = $(link).data('userid');
                if ($.inArray(userID, userIDs) === -1) {
                    userIDs.push(userID);
                }
            });

            return userIDs;
        };

    });
});
