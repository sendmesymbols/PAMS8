define([
    'jquery',
    'apps/shared/models/core_deferred',
    'apps/shared/controllers/localexchange',
    'soy!jive.shared.breadcrumb.placeLinkPopoverResults',
    'soy!jive.shared.breadcrumb.placeLinkBreadcrumb',
    'soy!jive.shared.breadcrumb.placeLinkRemoveConfirm',
    'soy!jive.shared.breadcrumb.breadcrumbIntroText',
    'soy!jive.shared.displayutil.a11yBoundary',
    'domReady!',
    'jquery-plugin/jquery.popover'
], function($, core, localexchange, linkPopoverDisplay, breadcrumbDisplay, removeConfirm, breadcrumbIntro, a11yBoundary) {
    $('#js-place-parents-link').on('click', function(e) {
        e.preventDefault();

        $('#js-place-parents-container').popover({
            context: $(this),
            darkPopover: true,
            destroyOnClose: false,
            hoverSelection: true
        });
    });

    function unbindPlaceLinkClickedEvent() {
        $('#js-place-link-breadcrumb').off('click', 'a.js-place-linked-content-link');
    }

    function bindPlaceLinkClickedEvent() {
        $('#js-place-link-breadcrumb').on('click', 'a.js-place-linked-content-link', function(e) {
            e.preventDefault();

            var $linkedPopoverContainer = $('#js-place-linked-content-container');
            var $placeLinkBreadcrumb = $('#js-place-link-breadcrumb');
            var linkedContentType = $placeLinkBreadcrumb.attr('data-linked-content-type');
            var linkedContentID = $placeLinkBreadcrumb.attr('data-linked-content-id');
            var context = $(this);

            core.getObject(linkedContentType, linkedContentID).then(function(content) {
                var filters = {
                    'contentID': '' + content.contentID
                };
                return core.runQuery(function(osapi) {
                    return osapi.jive.corev3.places.getPlacesRelatedToContentCount(filters);
                });
            }).then(function(response) {
                var newCount = response.content.count;
                if (newCount > 0) {
                    $linkedPopoverContainer.popover({
                        context: context,
                        darkPopover: true,
                        destroyOnClose: false,
                        hoverSelection: true,
                        onLoad: function() {
                            loadPlaceResults($linkedPopoverContainer, $('#js-place-link-breadcrumb'), newCount);
                        },
                        onClose: function() {
                            $linkedPopoverContainer.empty();
                        }
                    });
                }

                if (newCount != parseInt($placeLinkBreadcrumb.attr('data-place-link-count'))) {
                    refreshBreadcrumbCounts(newCount, false);
                }
            });
        });
    }

    bindPlaceLinkClickedEvent();

    function loadPlaceResults($linkedPopoverContainer, $placeLinkBreadcrumbElem, updatedCount) {
        var $placeLinkBreadcrumb = $placeLinkBreadcrumbElem || $('#js-place-link-breadcrumb');
        var linkedContentType = $placeLinkBreadcrumb.attr('data-linked-content-type');
        var linkedContentID = $placeLinkBreadcrumb.attr('data-linked-content-id');
        core.getObject(linkedContentType, linkedContentID).then(function(content) {
            var filters = {
                'contentID': '' + content.contentID
            };
            return core.runQuery(function(osapi) {
                return osapi.jive.corev3.places.getPlacesRelatedToContent(filters);
            });
        }).then(core.slurp).then(function(relatedPlaces) {
            var elems = $linkedPopoverContainer.children('span');

            if (elems.length == 0) {
                var start = a11yBoundary({
                    type: 'menu'
                });
                var end = a11yBoundary({
                    type: 'menu',
                    isEnd: true
                });
                $linkedPopoverContainer.prepend(start).append(end);
                elems = $linkedPopoverContainer.children('span');
            }

            var templateData = {
                places: relatedPlaces,
                placeLinkCount: updatedCount
            };

            if (elems.length > 0) {
                $(elems[0]).after(linkPopoverDisplay(templateData));
            }

            bindRemoveHandler($linkedPopoverContainer);
        }, function() {
            console.log('retrieving related places failed');
        });
    }

    function bindRemoveHandler(linkedContentContainer) {
        linkedContentContainer.find('a.js-remove-rel-confirm').on('click', function(e) {

            var $target = $(e.target);

            if (!$target.is('a')) {
                $target = $target.closest('a');
            }

            var relationshipID = $target.attr('data-relationship-id');

            var placeAnchor = $target.closest('li').find('a.js-shared-place-link');
            var placeLink;
            var placeIconCss;
            var placeName;

            if (placeAnchor && placeAnchor.length > 0) {
                placeLink = placeAnchor.attr('href');
                placeIconCss = placeAnchor.children('span.js-place-link-popover-icon').attr('class');
                placeName = placeAnchor.children('span.js-place-link-popover-name').text();
            }

            var templateData = {
                relationshipID: relationshipID,
                placeLink: placeLink,
                placeIconCss: placeIconCss,
                placeName: placeName
            };

            linkedContentContainer.html(removeConfirm(templateData));

            $('#js-place-link-breadcrumb').on('click', '#js-place-linked-content-container a.js-remove-rel-cancel', function() {
                $('#js-place-linked-content-container-placeholder').click();
            });
        });
    }

    function refreshBreadcrumbCounts(newCount, fromPopover) {
        var $placeLinkBreadcrumb = $('#js-place-link-breadcrumb');
        var hasPlaceLinkBreadcrumb = $placeLinkBreadcrumb && $placeLinkBreadcrumb.length > 0;

        if (hasPlaceLinkBreadcrumb) {
            var prevCount = parseInt($placeLinkBreadcrumb.attr('data-place-link-count'));
            var linkedContentID = parseInt($placeLinkBreadcrumb.attr('data-linked-content-id'));
            var linkedContentType = parseInt($placeLinkBreadcrumb.attr('data-linked-content-type'));

            if (typeof prevCount == 'number' && typeof linkedContentID == 'number' &&
                typeof linkedContentType == 'number') {
                var userContainerView = 'true' === $placeLinkBreadcrumb.attr('data-is-usercontainer');
                var legacyView = 'true' === $placeLinkBreadcrumb.attr('data-legacy');
                var hasPlace = 'true' === $placeLinkBreadcrumb.attr('data-place');
                var hasParents = 'true' === $placeLinkBreadcrumb.attr('data-parents');

                var templateData = {
                    placeLinkCount: newCount,
                    linkedContentID: linkedContentID,
                    linkedContentType: linkedContentType,
                    userContainer: userContainerView,
                    legacy: legacyView,
                    place: hasPlace,
                    parents: hasParents,
                    renderPopoverContainer: (prevCount == 0)
                };

                var $previousPopover;

                if (prevCount > 0) {
                    $previousPopover = $('#js-place-linked-content-container');
                }

                $placeLinkBreadcrumb.attr('data-place-link-count', newCount);
                unbindPlaceLinkClickedEvent();
                $placeLinkBreadcrumb = $placeLinkBreadcrumb.html(breadcrumbDisplay(templateData));
                bindPlaceLinkClickedEvent();

                if (fromPopover) {
                    //if anything was previously displayed, clear it out
                    if (prevCount > 0) {
                        $previousPopover.empty();
                    }
                    //show any new results, otherwise get rid of the popover container since there are no popover results anymore
                    if (newCount > 0) {
                        loadPlaceResults($previousPopover, $placeLinkBreadcrumb, newCount);
                    } else {
                        $previousPopover.closest('div.js-pop').remove();
                    }
                }

                //update intro text for non-legacy breadcrumbs
                if (!legacyView && !userContainerView &&
                    (prevCount == 0 && newCount > 0 || newCount == 0 && prevCount > 0)) {
                    var $introElem = $('#js-breadcrumb-intro');
                    var introTemplateData = {
                        messageKey: newCount > 0 ?
                            $introElem.attr('data-has-content-rel-intro-key') : $introElem.attr('data-no-content-rel-intro-key'),
                        hasRelationships: newCount > 0,
                        containerName: $introElem.attr('data-container-display-name'),
                        containerUrl: $introElem.attr('data-container-url'),
                        containerCss: $introElem.attr('data-container-icon-css'),
                        browseFilter: $introElem.attr('data-content-browse-filter'),
                        browseFromRootSpace: linkedContentType == 18 // special case for poll browse
                    };
                    if (introTemplateData.messageKey) {
                        $introElem.html(breadcrumbIntro(introTemplateData));
                    }
                }
            } else {
                location.reload();
            }
        } else {
            location.reload();
        }
    }

    localexchange.addListener('content.place.relationship.delete', function() {
        var $placeLinkBreadcrumb = $('#js-place-link-breadcrumb');
        var linkedContentType = $placeLinkBreadcrumb.attr('data-linked-content-type');
        var linkedContentID = $placeLinkBreadcrumb.attr('data-linked-content-id');
        core.getObject(linkedContentType, linkedContentID).then(function(content) {
            var filters = {
                'contentID': '' + content.contentID
            };
            return core.runQuery(function(osapi) {
                return osapi.jive.corev3.places.getPlacesRelatedToContentCount(filters);
            });
        }).then(function(response) {
            var newCount = response.content.count;
            refreshBreadcrumbCounts(newCount, true);
        });
    });

    localexchange.addListener('content.place.relationship.share.added', function(objectType, objectID) {
        core.getObject(objectType, objectID).then(function(content) {
            var filters = {
                'contentID': '' + content.contentID
            };
            return core.runQuery(function(osapi) {
                return osapi.jive.corev3.places.getPlacesRelatedToContentCount(filters);
            });
        }).then(function(response) {
            var newCount = response.content.count;
            refreshBreadcrumbCounts(newCount, false);
        });
    });
});
