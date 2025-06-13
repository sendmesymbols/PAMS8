/*
 * Copyright (C) 1999-2015 Jive Software. All rights reserved.
 *
 * This software is the proprietary information of Jive Software. Use is subject to license terms.
 */

define([
    'jquery',
    'url',
    'apps/shared/views/abstract_view',
    'jiverscripts/conc/observable',
    'soy!jive.eae.latestAcclaim.extraContent'
], function($, url, AbstractView, observable) {
    return AbstractView.extend(function(protect, _super) {
        
        observable(this);
        
        this.init = function(options) {
            this.options = options;
        };
        
        this.generateLeaderboard = function(data) {
            var html = $(jive.eae.latestAcclaim.extraContent({
                data: this.getTemplateData(data),
                currentUserID: this.options.currentUserID,
                currentUserPartner: this.options.currentUserPartner
            }));
    
            html.filter('.j-acclaim-status').find('a.js-status-legend-link').attr('href', url.baseUrl('/reputation-center?viewID=missions')).removeClass('js-status-legend-link');
            
            return html;
        };
        
        protect.getTemplateData = function(data) {
            var leaderboard = [];
            
            data.users.sort(function(a, b) {
                if (a.rank && b.rank) {
                    return parseInt(a.rank, 10) - parseInt(b.rank, 10);
                }
                return 0;
            });
            
            $.each(data.users, function(i, leader) {
                var obj = {
                    user: leader,
                    userStatusLevel: {
                        statusLevelName: leader.levelName,
                        imagePath: leader.iconUrl,
                        userPointTotal: leader.points
                    }
                };
                
                obj.user.id = leader.userId;
                
                leaderboard.push(obj);
            });
            
            var currentPoints = parseInt(data.currentUser.points, 10);
            var nextLevelPoints = parseInt(data.nextLevel.points, 10);
            
            return {
                leaderboard: leaderboard,
                showDateJoined: this.options.showDateJoined,
                pointsToNextLevel: (nextLevelPoints - currentPoints),
                statusLevelScenarios: []
            };
        };
        
    });
});
