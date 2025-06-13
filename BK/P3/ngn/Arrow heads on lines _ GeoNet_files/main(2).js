/*
 * Copyright (C) 1999-2015 Jive Software. All rights reserved.
 *
 * This software is the proprietary information of Jive Software. Use is subject to license terms.
 */

define([
    'apps/activity_stream/models/activity_stream_source',
    '../acclaim/main',
    '../challenges/main'
], function(ASSource, Acclaim, Challenges) {
    var original = ASSource.protected.getFullContent;
    ASSource.protected.getFullContent = function(type, id) {
        if (type == 1150305777) {
            var acclaim = new Acclaim();
            return acclaim.getLeaderboard();
        }
        var main = this;
        return original.call(main, type, id);
    };
});
