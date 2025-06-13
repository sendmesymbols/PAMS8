/*
 * Copyright (C) 1999-2015 Jive Software. All rights reserved.
 *
 * This software is the proprietary information of Jive Software. Use is subject to license terms.
 */

define('apps/outcomes/v2_badge_view', [
    'jquery',
    'underscore',
    'application/base_view',
    'channel!outcomes',
    'channel!commentListView',
    'apps/outcomes/viewUtil',
    'apps/outcomes/outcomesModel',
    'jive/promise_util',
    'apps/outcomes/helpfulView',
    'apps/shared/views/itemList',
    'apps/shared/controllers/localexchange',
    'jsurl',
    'soy!jive.unified.content.view.badges',
    'soy!jive.unified.content.view.badgePopup',
    'apps/outcomes/v2_badge_toplevel_view'
], function($, _, View, outcomesChannel, commentListView, ViewUtil, OutcomesModel, promiseUtil, HelpfulView, ItemList, localexchange, Url, BadgesTemplate, PopupTemplate) {
    'use strict';

    return View.extend({
        events : {
            'click li.js-outcome-type-mostliked' : 'getMostLikedPopupData',
            'click li.js-outcomes-v2:not(.js-outcome-type-mostliked)' : 'getOutcomesSummaryPopupData'
        },

        initialize: function(options) {
            this.options = options;
            this.$outcomeContainer = this.$el.find('.js-outcome-badge-container');
            this.ed = {type: this.options.objectType, id: this.options.objectId};
            this.getBadgesForBadgesRegion(ViewUtil.getEd(this.$el));
            outcomesChannel.on('outcomes.refreshContentRegion', _.bind(this.getBadgesForBadgesRegion, this));
        },

        getUrlObj: function() {
            return new Url(location.href);
        },

        showBadgeRegion: function(html) {
            this.$el.removeClass('j-region-hidden');
            this.$outcomeContainer.html(html);
        },

        hideBadgeRegion: function() {
            this.$el.addClass('j-region-hidden');
            this.$outcomeContainer.html('');
        },


        getBadgesForBadgesRegion: function(ed) {
            var view = this;
            function _commentsNotRestricted(contentObj) {
                return !contentObj.restrictReplies || !contentObj.restrictComments;
            }

            ed = ed || view.ed;  //if we don't specify a specific region, assume we mean the outcomes summary region
            OutcomesModel.clearEntityCache();
            OutcomesModel.getObject(ed).done(function(contentObject) {
                if (_commentsNotRestricted(contentObject)) {
                    $.when(OutcomesModel.getOutcomeCounts(ed), OutcomesModel.getMostLikedReplies(ed)).done(_.bind(view.handleBadgesRender, view));
                }
            });
        },

        handleBadgesRender: function(outcomeCounts, replies) {
            var badges = this.getBadgesFromData(outcomeCounts, replies);
            if (badges.length > 0) {
                this.showBadgeRegion(BadgesTemplate({outcomes: badges}));
            } else {
                this.hideBadgeRegion();
            }
        },

        getBadgesFromData: function(outcomeCounts, replies) {
            var view = this;
            var badges = [];
            if (replies.length > 0) {
                badges.push({
                    outcomeType: 'mostLiked',
                    outcomeCount: replies.length
                });
            }

            if (!_.isEmpty(outcomeCounts)) {
                var allowedOutcomeCounts = _.has(view.options, 'allowedOutcomeTypes') ? _.pick(outcomeCounts, view.options.allowedOutcomeTypes) : outcomeCounts;
                $.each(allowedOutcomeCounts, function (outcomeType, outcomeCount) {
                    if (outcomeType != 'helpful' || view.validateHelpfulBadge(outcomeCount)) {
                        badges.push({
                            outcomeType: outcomeType,
                            outcomeCount: outcomeCount
                        });
                    }
                });
            }

            return badges;
        },

        validateHelpfulBadge: function(outcomeCount) {
            return outcomeCount >= _.get(this.options, 'helpfulMinReplies', 1);
        },

        getMostLikedPopupData: function(e) {
            e.preventDefault();
            var view = this;
            var ed = view.ed;
            var $context = $(e.target).parent();
            $.when(OutcomesModel.getObject(ed), OutcomesModel.getMostLikedReplies(ed)).done(function(contentObj, replies) {
                var filteredReplies = view.filterMostLikedReplies(replies);
                if (filteredReplies.length > 0) {
                    localexchange.emit('outcome.rollupMostLiked', filteredReplies.valueOf(), contentObj.subject, $context);
                }
            });
        },

        filterMostLikedReplies: function(replies) {
            var view = this;
            var filteredReplies = _.filter(replies, function(r) {
                return r.likeCount >= _.get(view.options, 'mostLikedMinLikes', 1);
            });

            return filteredReplies.slice(0, _.get(view.options, 'mostLikedRollupLimit', 20));
        },

        filterOutcomeCommentsByType: function(comments, type) {
            var commentsWithOutcomes = _.filter(comments, function(c) { return c.outcomes && c.outcomes.length > 0});
            var commentsWithOutcomesOfType = _.filter(commentsWithOutcomes, function(c) { return _.has(c.outcomes, type)});

            return commentsWithOutcomesOfType;
        },

        getOutcomesSummaryPopupData: function(e) {
            e.preventDefault();
            var view = this;
            var subject;
            var ed = this.ed;
            var $context = $(e.target).parent();
            var outcomeTypeName = $(e.target).parent().data('outcomeType');

            OutcomesModel.getObject(ed).then(function(contentObj) {
                subject = contentObj.subject;
                return $.when(OutcomesModel.getRepliesByOutcomeTypes(contentObj, [outcomeTypeName]), OutcomesModel.getOutcomesForObj(contentObj), contentObj);
            }).then(function(comments, tloOutcomes, contentObj) {
                for (var i = 0; i < tloOutcomes.length; ++i) {
                    if (tloOutcomes[i].outcomeType.name.toLowerCase() == outcomeTypeName) {
                        comments.unshift(contentObj);
                    }
                }
                return OutcomesModel.getAllOutcomes(comments, 'outcomes');
            }).done(function(comments) {
                var approverPromises = [];
                $.each(comments, function(i, c) {
                    $.each(c.outcomes, function (i, o) {
                        approverPromises.push(OutcomesModel.getApproverUsers(o));
                    });
                });
                promiseUtil.whenAll(approverPromises).done(function() {
                    view.createSummaryPopup(outcomeTypeName, view.filterOutcomeCommentsByType(comments, outcomeTypeName), $context, subject);
                });

            });
        },

        createSummaryItemData: function(comment, outcomeTypeName, subject) {
            var byLine = this.getOutcomeByLine(comment,subject);
            var outcome = this.getOutcomeObject(comment.outcomes, outcomeTypeName);
            var actions = this.getBadgePopupActions(outcome);
            var summaryItemData = {
                outcomeTypeName: outcomeTypeName,
                author: this.getOutcomeAuthor(comment.outcomes, outcomeTypeName),
                modifiedDate: outcome.updated,
                linkActions: ViewUtil.buildLinkActions(actions),
                alertedNames: outcome.properties.alertedUsers || false,
                share: outcome.properties.outcomeShare || false,
                props: outcome.properties,
                comment: outcome.note,
                actions: actions,
                contentTitle: byLine.subject,
                contentLink: byLine.link,
                containerSelector: '.js-ed-' + comment.typeCode + '-' + comment.id,
                canHaveActionLink: this.getCanHaveActionLink(outcomeTypeName, comment.resources),
                originalOutcome : outcome,
                entity : {type : comment.typeCode, id : comment.id}
            };

            this.populateBadgeMetadata(outcome,summaryItemData);

            return summaryItemData;
        },

        createSummaryPopup: function(outcomeTypeName, comments, $context, subject) {
            var view = this;
            var summaryItems = [];
            if (comments.length > 0) {
                $(comments).each(function(i, comment) {
                    summaryItems.push(view.createSummaryItemData(comment, outcomeTypeName, subject));

                });

                var $popover = $(PopupTemplate({outcomeItems: summaryItems})).popover({
                    context: $context,
                    hoverSelection: true,
                    onClose: function() {
                        $context.removeAttr('aria-owns');
                    }
                });

                $context.attr('aria-owns', $popover.id());
                ItemList.bindHandlers($popover);

                $.each(summaryItems, function(i, o) {
                    if (o.originalOutcome.predecessorOutcome) {
                        localexchange.emit('outcome.history.displayLink', o.originalOutcome, o.alertedNames, $popover.find('.js-outcome-item-actions-' + o.originalOutcome.id), o.entity, $context);
                    }
                });

                view.bindPopoverHandlers($popover);
                localexchange.addListener('outcome.history.popoverDisplayed', function() {
                    $popover.trigger('close');
                });
            }
        },

        bindPopoverHandlers: function($popover) {
            var view = this;
            $popover.on('click', '.js-actionLink', function(e) {
                e.preventDefault();
                var $this = $(this);
                var data = $this.data();
                var $container;
                var $badgeContext;
                var ed;
                if (data.actionData.name === 'helpful') {
                    var parsedSelector = data.containerSelector.split('-'),
                        containerType = parseInt(parsedSelector[2]),
                        containerId = parseInt(parsedSelector[3]),
                        $link;

                    $('.js-outcome-helpful-container').each( function(){
                        if ($(this).data('objectType') == containerType && $(this).data('objectId') == containerId) {
                            $link = $(this).find('.js-helpful-link');
                        }
                    });
                    HelpfulView.unmarkUnhelpful($link);
                }
                $container = data.containerSelector ? $(data.containerSelector) : $('.j-region-outcomes .js-outcome-badge-container');
                $badgeContext = $container.find('li[data-outcome-type="' + data.actionData.name + '"]');
                ed = ViewUtil.getEd($container);
                localexchange.emit('outcome.doAction', data.event, ed, data.actionData, $badgeContext);
                $this.trigger('close');
            }).on('click','.j-outcome-byline a[href^="#comment"]',function(e){
                e.preventDefault();
                var urlObj = view.getUrlObj();
                if ($('.j-outcome-type-finalized').length > 0) {  //content has a unique "marked as final" outcome
                    localexchange.emit('outcome.expandCollapsedComments');
                } else if (urlObj.query['mode'] === 'backchannel') {  //We're trying to view comment outcomes in backchannel mode
                    location.href = '?mode=comments' + $(this).attr('href');
                    return;
                }
                location.href = $(this).attr('href');
            });

        },


    getCanHaveActionLink: function(outcomeTypeName, resources) {
        if (resources['helpful'] && outcomeTypeName == 'helpful') {
            return $.inArray('DELETE', resources.helpful.allowed) != -1;
        } else {
            return true;
        }
    },

    getOutcomeAuthor: function(outcomes, outcomeTypeName) {
        return outcomes[outcomeTypeName].user ;
    },

    getOutcomeObject: function(outcomes,outcomeTypeName) {
        return outcomes[outcomeTypeName];
    },

    getOutcomeByLine: function(contentObject, subject) {
        var byline = {},
            regex1 = /<div class="jive-rendered-content">(.*?)<\/div>/ig,   //grab the meat of the post
            regex2 = /(<([^>]+)>)/ig;                                       //strip off all the html elements
        if (contentObject.entityType != 'comment' && contentObject.entityType != 'message') {
            byline.subject = subject;
            byline.link = '#jive-body-main';
        } else {
            var post = contentObject.content.text.match(regex1);
            post = post[0].replace(regex2,'');
            if (post.length > 20) {
                post = post.substr(0,19) + '...';
            }
            byline.subject = post;
            byline.link = '#comment-' + contentObject.id;
        }
        return byline;
    },

    getBadgePopupActions: function(outcome) {
        function Action(subject, verb, context) {
            this.subject = subject;
            this.verb = verb;
            this.context = context;
        }

        function shouldAddDeleteAction(outcome) {
            var unresolvedWithTransitions = outcome.outcomeType.name != 'resolved' && outcome.successorOutcomeTypes.length;
            var noTransitions = outcome.successorOutcomeTypes[0] == null;
            return outcome.destroy && (unresolvedWithTransitions || noTransitions);
        }

        var result = [];
        //resolved outcomes cannot be deleted until JIVE-29800 is implemented. remove unnecessary delete links.
        if (shouldAddDeleteAction(outcome)) {
            result.push(new Action(outcome.outcomeType, 'delete', null));
        }

        if (outcome.createOutcome && outcome.successorOutcomeTypes) {
            $.each(outcome.successorOutcomeTypes, function () {
                result.push(new Action(this, 'post', outcome));
            });
        }
        return result;
    },

    populateBadgeMetadata: function(outcome, contentData) {
        function ShareLinkAction(labelSuffix, event, actionData, href) {
            this.labelSuffix = labelSuffix;
            this.event = event;
            this.actionData = actionData;
            this.href = href;
        }

        if (outcome.properties) {
            // assignees list
            var alertedNames = [];
            if (outcome.properties.alertedUsers) {
                $.each(outcome.properties.alertedUsers, function (i, user) {
                    alertedNames.push(user.displayName);
                });
                contentData.alertedNames = alertedNames;
            }
            if (outcome.outcomeType.name == 'pending') {
                if (alertedNames.length == 0) { // still add owner as lone assignees for unshared outcomes that support sharing
                    alertedNames.push(outcome.user.displayName);
                    contentData.alertedNames = alertedNames;
                }
                if (outcome.properties.outcomeShare) { // link to view communication
                    if (document.URL != outcome.properties.outcomeShare.resources.html.ref) {
                        var labelSuffix = outcome.outcomeType.name.toLowerCase() + '.' + 'view';
                            contentData.shareLink = new ShareLinkAction(labelSuffix, null, null,
                                outcome.properties.outcomeShare.resources.html.ref);
                        }
                    }
                    else if (outcome.update) { // insert link to update outcome to add assignees
                        var labelSuffix = outcome.outcomeType.name.toLowerCase() + '.' + 'put';
                        contentData.shareLink = new ShareLinkAction(labelSuffix, 'outcome.put',
                            JSON.stringify(outcome.outcomeType), null);
                    }
                }
            }
        }
    });
});
