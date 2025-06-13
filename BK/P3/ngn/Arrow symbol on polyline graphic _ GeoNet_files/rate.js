/*
 * $Revision$
 * $Date$
 *
 * Copyright (C) 1999-2015 Jive Software. All rights reserved.
 *
 * This software is the proprietary information of Jive Software. Use is subject to license terms.
 */
define([
    'jquery',
    'url',
    'soy!jive.rate.soy.renderRating',
    'soy!jive.rate.soy.renderUserRating'
], function($, url) {

    return function(containerType, containerID, objectType, objectID, shortObjectType, i18n, allowComments, guid, rteOptions) {

        var RATE_ENDPOINT = url.v2Url('/rating/' + objectType + '/' + objectID);

        var ratingInfo;
        var userRating;
        var ratingDescription;
        var inProgress;
        var scores;
        var commentable;
        var $container;

        $.getJSON(RATE_ENDPOINT, function(data) {
            ratingInfo = data.ratingInfo;
            initRatings();
            findContainer();
            initHtml();

            if (commentable) {
                var options = {
                    body: '',
                    element: $container,
                    i18n: i18n,
                    containerType: containerType,
                    containerID: containerID,
                    resourceType: objectType,
                    resourceID: objectID,
                    rteOptions: rteOptions
                };
                require(['apps/rate/main'], function(Rate) {
                    new Rate(options);
                });
            }
        });

        /**
         * Finds the div that holds the html representing this Rate instance and
         * stores a reference to it.
         */
        function findContainer() {
            if (guid) {
                $container = $('.jive-content-rating[data-guid="' + guid + '"]');
            } else {
                $container = $('#jive-content-rating');
            }
        }

        function initRatings() {
            userRating = (ratingInfo.ratedByUser && ratingInfo.userRating.score > 0) ? ratingInfo.userRating.score : 0;
            ratingDescription = ratingInfo.userRating ? ratingInfo.userRating.description : '';
            inProgress = false;
            scores = ratingInfo.availableRatings;
            commentable = ratingInfo.commentable && allowComments;
        }

        function update(saving) {
            $.getJSON(RATE_ENDPOINT, function(data) {
                updateRatings(data);
                saving.resolve();
            });
            return false;
        }

        function updateRatings(ratingData) {
            require(['soy!jive.rate.soy.renderRating'], function(renderRating) {
                ratingData.i18n = i18n;
                var html = renderRating(ratingData);
                $container.find('.jive-content-avgrating').html(html);
            });
        }

        function addRating(score) {
            inProgress = true;

            // show saving message
            var $saving = $container.find('.j-rating-comment-instruct .font-color-okay strong'),
                saved = new $.Deferred();
            $saving.html(i18n.rateSavingText);

            if (!$container.find('.j-rating-container').hasClass('j-rating-container-active')) {
                $container.find('.j-rating-container').addClass('j-rating-container-active');
                if (!$container.find('.j-rating-container').hasClass('j-rating-container-active-tab')) {
                    $container.find('.j-rating-comment-instruct').css('opacity', '0').animate({
                        width: 'toggle',
                        opacity: 1
                    }, 500);
                }
            }

            // dwr call to add rating
            $.post(RATE_ENDPOINT, {
                'score': score
            }, function() {
                update(saved);

                userRating = score;
                showUserRating(score);

                $container.find('.jive-icon-userrating-' + score).attr('aria-pressed', 'true');
                $container.find('.jive-icon-userrating-' + score).prevAll('a').attr('aria-pressed', 'false');
                $container.find('.jive-icon-userrating-' + score).nextAll('a').attr('aria-pressed', 'false');
                $container.find('.jive-icon-userrating-' + score).focus();
            });

            saved.then(function() {
                // changed saving message to saved
                $saving.html(i18n.rateSavedText);

                // hide saved message
                if (!commentable) {
                    $container.find('.j-rating-comment-instruct').fadeOut(2500, function() {
                        $container.find('.j-rating-container').removeClass('j-rating-container-active');
                    });
                }
                inProgress = false;
            });
        }

        function showUserRating(score) {
            $.each(scores, function(i, rating) {
                if (score == 0) {
                    $container.find('.jive-content-userrating-desc').html('');
                }
                if (score == rating.score) {
                    $container.find('.jive-content-userrating-desc').html(rating.description);
                }
                $container.find('.jive-icon-userrating-' + rating.score)
                    .toggleClass('jive-icon-rate-usr-on', score >= rating.score)
                    .toggleClass('jive-icon-rate-usr-off', score < rating.score);
            });
        }

        function initHtml() {
            var output = jive.rate.soy.renderRating({
                ratingInfo: ratingInfo,
                i18n: i18n
            });

            if (ratingInfo.rateable) {
                output += jive.rate.soy.renderUserRating({
                    ratingInfo: ratingInfo,
                    userRating: userRating,
                    commentable: commentable,
                    ratingDescription: ratingDescription,
                    i18n: i18n
                });
            }

            $container.append(output);
            $container.find('.jive-content-userrating').show();

            $.each(ratingInfo.availableRatings, function(i, availableRating) {

                $container.find('.jive-icon-userrating-' + availableRating.score).bind('click', function() {
                    addRating(availableRating.score);
                });

                $container.find('.jive-icon-userrating-' + availableRating.score).hover(
                    function() {
                        showUserRating(availableRating.score);
                    },
                    function() {
                        showUserRating(userRating);
                    }
                );

                $container.find('.jive-icon-userrating-' + availableRating.score).bind('focus', function() {
                    showUserRating(availableRating.score);
                });

                $container.find('.jive-icon-userrating-' + availableRating.score).bind('blur', function() {
                    showUserRating(userRating);
                });
            });
        }
    };
});
