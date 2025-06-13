/*
 * Copyright (C) 1999-2015 Jive Software. All rights reserved.
 *
 * This software is the proprietary information of Jive Software. Use is subject to license terms.
 */

define([
    'jiverscripts/oo/class',
    'jiverscripts/conc/promise',
    './models/acclaim_source',
    './views/acclaim_view'
], function(Class, Promise, AcclaimSource, AcclaimView) {
    return Class.extend(function(protect, _super) {
        
        this.init = function(options) {
            this.source = new AcclaimSource({
                currentUserID: window._jive_current_user.ID
            });
            this.view = new AcclaimView({
                currentUserID: window._jive_current_user.ID,
                currentUserPartner: window._jive_current_user.partner,
                showDateJoined: true
            });
        };
        
        this.getLeaderboard = function() {
            var promise = new Promise();
            var self = this;
            
            this.source.getLeaderboard().addCallback(function(data) {
                promise.emitSuccess({
                    html: self.view.generateLeaderboard(data),
                    extraData: {}
                });
            });
            
            return promise;
        };
    });
});
