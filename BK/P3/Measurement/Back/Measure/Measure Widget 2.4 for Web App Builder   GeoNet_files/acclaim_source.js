/*
 * Copyright (C) 1999-2015 Jive Software. All rights reserved.
 *
 * This software is the proprietary information of Jive Software. Use is subject to license terms.
 */

define([
    'jquery',
    'underscore',
    'apps/shared/models/rest_service',
    'jiverscripts/conc/promise',
    '../../../jive-nitro',
    '../../shared/models/userService',
    '../../../lib/n4jive/n4jive.core'
], function($, _, RestService, Promise, JiveNitro, UserService, n4jive) {
    return RestService.extend(function(protect, _super) {
    
        this.init = function(options) {
            _super.init.call(this, options);
            
            this.options = options;
            this.nitro = new JiveNitro();
        };
        
        this.getLeaderboard = function() {
            var self = this;
            var result = new Promise();
            
            this.nitro.addMethod("site.getPointsLeaders", {
                pointCategory: 'Points',
                withRank: true,
                withSurroundingUsers: true,
                duration: 'ALLTIME',
                userIds: this.options.currentUserID,
                criteria: 'CREDITS'
            });
            
            this.nitro.execute(function(res, promise) {
                self.handleLeadersResponse(res, promise);
            }).addCallback(function(data) {
                result.emitSuccess(data);
            }).addErrback(function(err, message) {
                result.emitError(err, message);
            });
            
            return result;
        };
        
        protect.handleLeadersResponse = function(res, promise) {
            var self = this;
            var data = {
                users: this.getUsersFrom(res)
            };
            
            $.each(data.users, function(userId, user) {
                if (userId == self.options.currentUserID) {
                    data.currentUser = user;
                }
            });
            
            $.when(this.addUserDetails(data), this.addUserStatusLevels(data)).done(function() {
                promise.emitSuccess({
                    nextLevel: data.nextLevel,
                    currentUser: data.currentUser,
                    users: _.values(data.users)
                });
            });
        };
        
        protect.addUserStatusLevels = function(data) {
            var dfd = new $.Deferred();
            var locale = n4jive.locale(this.nitro.isLocalizationEnabled());
    
            this.nitro.addMethod("user.getLevel", n4jive.extendWithLocale({
                userIds: Object.keys(data.users).join(',')
            }, locale)).addMethod("user.getNextLevel", {
                userId: this.options.currentUserID
            });
            
            this.nitro.execute(function(res, promise) {
                res.eachMethod("user.getLevel", function(method) {
                    $.each($.makeArray(method.users.User), function(i, user) {
                        $.extend(data.users[user.userId], n4jive.extendWithLocale({
                            description: user.SiteLevel.description,
                            iconUrl: user.SiteLevel.iconUrl,
                            levelName: user.SiteLevel.name
                        }, locale));
                    });
                });
                
                res.eachMethod("user.getNextLevel", function(method) {
                    data.nextLevel = method.users.User.SiteLevel;
                });
                
                dfd.resolveWith(this);
            });
            
            return dfd;
        };
        
        protect.addUserDetails = function(data) {
            var userService = new UserService({});
            var dfd = new $.Deferred();
            
            userService.getProfileInfo({
                userId: Object.keys(data.users),
                success: function(jiveUsers) {
                    $.each(jiveUsers.Users, function(i, user) {
                        $.extend(data.users[user.userId], user);
                    });
                    dfd.resolveWith(this);
                },
                error: function(xhr, status, error) {
                    console.log('Error getting user details: '+status+'/'+error);
                }
            });
            
            return dfd;
        };
        
        protect.getUsersFrom = function(res) {
            var users = {};
            
            $.each(res.Nitro.Nitro, function(i, method) {
                if (method.method === "site.getPointsLeaders") {
                    $.each($.makeArray(method.leaders.Leader), function(j, obj) {
                        users[obj.userId] = {
                            points: obj.points,
                            rank: obj.rank
                        };
                    });
                }
            });
            
            return users;
        };
        
    });
});

