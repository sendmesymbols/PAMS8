/*
 * $Revision$
 * $Date$
 *
 * Copyright (C) 1999-2015 Jive Software. All rights reserved.
 *
 * This software is the proprietary information of Jive Software. Use is subject to license terms.
 */
/**
 * TLO summary count view
 */
define([
    'jquery',
    'apps/shared/controllers/localexchange',
    'apps/outcomes/viewUtil',
    'apps/shared/views/itemList',
    'apps/outcomes/outcomesMain',
    'soy!jive.outcomes.summary.summaryCount',
    'soy!jive.outcomes.summary.rollup',
    'soy!jive.outcomes.badge.badgeDetails',
    'jquery-plugin/jquery.safeRemove'
], function($, localexchange, viewUtil, itemList) {
    function outcomeSummary(ed, outcomeCounts, replies, contentObj) {
        var $summaryContainer = $('#js-outcome-summary-container-' + ed.type + '-' + ed.id);
        if ($summaryContainer.length && outcomeCounts) {
            $.each(outcomeCounts, function(outcomeTypeName, count) {
                //finalized, outdated, and official should only be rendered as part of the TLO badge row and not the comment section badge row.
                if (count > 0 && outcomeTypeName != 'finalized' && outcomeTypeName != 'outdated' && outcomeTypeName!= 'official') {
                    var summaryCount = jive.outcomes.summary.summaryCount({
                        outcomeType: outcomeTypeName,
                        count: count
                    });
                    if (0 == $summaryContainer.children('.js-outcome-summary-count.js-outcome-type-' + outcomeTypeName).replaceWith(summaryCount).length) {
                        viewUtil.placeItem($summaryContainer, summaryCount, outcomeTypeName, function($container, str) {
                            return $container.children('.js-outcome-summary-count.js-outcome-type-' + str);
                        }, 200);
                    }
                } else {
                    $summaryContainer.children('.js-outcome-summary-count.js-outcome-type-' + outcomeTypeName).safeRemove();
                }
            });
            $summaryContainer.children('.js-outcome-summary-count.js-mostLiked').safeRemove();
            localexchange.emit('mostLiked.badge', $summaryContainer, replies, contentObj.subject);
        }

        if ($summaryContainer.length) {
            $(function() {
                $summaryContainer.off();
                $summaryContainer.on('click', 'li', function showRollup(ev) {
                    ev.preventDefault();

                    var $context = $(this);
                    if (!$context.attr('data-outcome-type')) {
                        return;
                    }
                    //Toggle display of the summary roll up
                    if ($context.attr('aria-owns')) {
                        $('#' + $context.attr('aria-owns')).trigger('close');
                    } else {
                        var outcomeTypeName = $context.data('outcomeType'),
                            $container = $context.closest('.js-outcome-summary-container'),
                            objectType = $container.data('objectType'),
                            objectId = $container.data('objectId');
                        localexchange.emit('outcome.rollup', {
                            id: objectId,
                            type: objectType
                        }, outcomeTypeName, $context);
                    }
                });
                $summaryContainer.on('click', '.js-mostLiked', function showRollup(ev) {
                    ev.preventDefault();
                    var $context = $(this);
                    localexchange.emit('outcome.rollupMostLiked', replies.valueOf(), contentObj.subject, $context);
                });
            });
        }
    }

    localexchange.addListener('outcome.summary', outcomeSummary);

    function outcomeRolledup(outcomeTypeName, replies, $context, subject) {
        //Render the comments template
        var popoverContent = jive.outcomes.summary.rollup({
            replies: replies,
            outcomeType: outcomeTypeName,
            tloTitle: subject
        });
        var popOpts = {
            context: $context,
            returnPopover: true,
            hoverSelection: true,
            onClose: function() {
                $context.removeAttr('aria-owns');
            }
        };
        var $rollup = $(popoverContent).popover(popOpts);
        $context.attr('aria-owns', $rollup.id());

        function getExpandedHeight($body) {
            var isExpanded = $body.hasClass('j-js-expanded');
            if (!isExpanded) {
                $body.addClass('j-js-expanded');
            }
            var ret = $body.height();
            if (!isExpanded) {
                $body.removeClass('j-js-expanded');
            }
            return ret;
        }

        $rollup.find('.js-outcome-reply-body').each(function() {
            var $this = $(this);
            if (getExpandedHeight($this) > 150) {
                $this.next('.js-outcome-more').show();
            }
        });

        //More button click handler
        $rollup.find('.js-outcome-more').on('click', function(ev) {
            $(this).hide()
                .prev('.js-outcome-reply-body').addClass('j-js-expanded');
            ev.preventDefault();
        });

        //Done button click handler
        $rollup.find('.js-outcome-done-button').on('click', function(ev) {
            popOpts.closeFunc();
            ev.preventDefault();
        });

        //In-context link (date link) click handler
        $rollup.find('a.js-outcome-reply-incontext').on('click', function() {
            popOpts.closeFunc();
            var match = /#.*$/.exec($(this).attr('href'));
            if (match) {
                jive.conc.nextTick(function() {
                    jive.Accessibility.focusIn($(match[0]));
                });
            }

            localexchange.emit('outcome.expandCollapsedComments');

            //don't preventDefault; navigate to the link target
        });

        //Show in context link click handler
        $rollup.find('.js-outcome-link-incontext').on('click', function() {
            popOpts.closeFunc();
            var match = /#.*$/.exec($(this).attr('href'));
            if (match) {
                jive.conc.nextTick(function() {
                    jive.Accessibility.focusIn($(match[0]));
                });
            }

            localexchange.emit('outcome.expandCollapsedComments');

            //don't preventDefault; navigate to the link target
        });

        localexchange.emit('renderedContent', $rollup);
        localexchange.emit('outcome.rollupDisplayed', outcomeTypeName, replies);
    }

    function clickHandler(ev) {
        if (ev) {
            ev.preventDefault();
        }
        var $link = $(this);
        if ($link.data('outcomeUrl')) {
            showDetails($link.closest('.j-outcome-badge-popup'), $link.data('outcomeUrl'));
        } else {
            console.log('link is missing outcomeUrl: ', $link);
        }
    }

    function showDetails($context, outcomeUrl) {
        localexchange.emitP('outcome.prepareOutcomeDetails', outcomeUrl).then(function(outcome) {
            var $detailsContainer = $context.find('.j-outcome-details');

            var templateData = {
                comment: $('<div/>').html(outcome.note).text()
            };

            var alertedNames = [];
            if (outcome.properties.alertedUsers) {
                $.each(outcome.properties.alertedUsers, function(i, user) {
                    alertedNames.push(user.displayName);
                });
                templateData.alertedNames = alertedNames;
            }

            var html = jive.outcomes.badge.badgeDetails(templateData);
            $detailsContainer.append(html).slideDown();

            $context.find('.js-outcome-link').toggle().focus(); // replace details link with in-context link
            itemList.bindHandlers($context);
        });
    }

    function refreshSummary(context) {
        context = context || document;
        $('.js-outcome-summary-container', context).each(function() {
            localexchange.emit('outcome.summarize', viewUtil.getEd(this));
        });
    }

    function commentRollup(ed, outcome) {
        var outcomeTypeName = outcome.outcomeType.name.toLowerCase();
        if (outcomeTypeName != 'finalized')
            return;

        localexchange.emit('outcome.collapseComments');
    }

    localexchange.addListener('outcome.rolledup', outcomeRolledup);
    localexchange.addListener('outcome.refreshSummary', refreshSummary);
    localexchange.addListener('outcome.created', commentRollup);

    return {
        summarize: refreshSummary,
        outcomeRollup: outcomeRolledup,
        clickHandler: clickHandler
    };
});
