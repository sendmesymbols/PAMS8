/*
 * Copyright (C) 1999-2015 Jive Software. All rights reserved.
 *
 * This software is the proprietary information of Jive Software. Use is subject to license terms.
 */

define('apps/outcomes/v2_badge_toplevel_view', [
    'jquery',
    'underscore',
    'application/base_view',
    'channel!outcomes',
    'apps/outcomes/viewUtil',
    'apps/shared/views/itemList',
    'apps/shared/controllers/localexchange',
    'soy!jive.unified.content.view.headerBadgePopup',
    'soy!jive.unified.content.view.outdatedWarning'
], function($, _, View, outcomesChannel, ViewUtil, ItemList, localexchange, HeaderBadgePopupTemplate, OutdatedWarningTemplate) {
    'use strict';

    outcomesChannel.on('outcomes.topLevelBadgePopup', function($badge, templateData) {
        var html = HeaderBadgePopupTemplate(templateData);
        var context = $badge;
        var $popover = $(html).popover({
            context: $badge,
            hoverSelection: true,
            container: $('.j-messages-wrapper'),
            onClose: function() {
                $badge.removeAttr('aria-owns');
            }
        });
        $badge.attr('aria-owns', $popover.id());
        ItemList.bindHandlers($popover);
    });

    outcomesChannel.on('outcomes.doOutdatedMessage', function(){
        var html = '',
            params = {},
            badgeData = {},
            $outdatedMessageContainer = $('.j-content-outdated-container'),
            $outdatedBadge = $('.j-outcome-badge-container-top-v2 > li.js-outcome-type-outdated');

        $outdatedMessageContainer.removeClass('j-content-outdated-hidden');
        badgeData = $outdatedBadge.data('templatedata');
        params = {
            linkTitle : badgeData.props.title,
            linkUrl : badgeData.props.url
        };
        html = OutdatedWarningTemplate(params);
        $outdatedMessageContainer.html(html);

        $('#dismissOutdatedModal').on('click', function(e){
            e.preventDefault();
            $('.j-content-outdated-container').addClass('j-content-outdated-hidden');
        });
    });

    $(document.body).on('click', 'ul.js-outcome-badge-container-top > li.js-outcome-badge', function() {
        outcomesChannel.trigger('outcomes.topLevelBadgePopup', $(this), $(this).data('templatedata'));
    })
    .on('click', 'ul.js-outcome-badge-container-top > li.js-outcome-badge .js-actionLink', function(e){
        e.preventDefault();
        e.stopPropagation();
        var $this = $(this);
        var $container = $('.js-outcome-badge-container-top');
        var ed = ViewUtil.getEd($container);
        localexchange.emit('outcome.doAction', $this.data('event'), ed, $this.data('actionData'), $this.closest('li'));
        $this.trigger('close');
    });


});
