/*
 * $Revision$
 * $Date$
 *
 * Copyright (C) 1999-2015 Jive Software. All rights reserved.
 *
 * This software is the proprietary information of Jive Software. Use is subject to license terms.
 */

/**
 * Handles Share functionality
 */
define([
    'jive/dispatcher'
], function() {
    var main;
    jive.dispatcher.listen('deleteContentPlaceRel', function(payload) {
        require(['apps/contentplace_relationship/main'], function(ContentPlaceRelationshipApp) {
            main = main || new ContentPlaceRelationshipApp();
            main.deleteRelationship(payload);
        });
    });
    jive.dispatcher.listen('deleteContentPlaceRelBreadcrumb', function(payload) {
        require(['apps/contentplace_relationship/main'], function(ContentPlaceRelationshipApp) {
            main = main || new ContentPlaceRelationshipApp();
            main.deleteRelationship(payload,
                function() {});
        });
    });
});
