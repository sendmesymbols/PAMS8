/*
 * Copyright (C) 1999-2015 Jive Software. All rights reserved.
 *
 * This software is the proprietary information of Jive Software. Use is subject to license terms.
 */

define('apps/content/full_screen_view', [
    'jquery',
    'application/base_view'
], function($, View) {
    'use strict';

    return View.extend({
        events : {
            'click .j-fullscreen-label' : 'toggleFullScreenView'
        },
        toggleFullScreenView : function(e) {
            $('body').toggleClass('j-fullscreen-view');

            if($('body').hasClass('j-fullscreen-view')) {
                $('.js-add-comment').on('click', this.toggleFullScreenView);
            } else {
                $('.js-add-comment').off('click');
            };

            $('#js-fullScreenButton').find('.j-fullscreen-label').each(function() {
                ($(this).attr('aria-hidden') == 'true') ? $(this).attr('aria-hidden', 'false') : $(this).attr('aria-hidden', 'true');
            });
            $(window).resize();     //need to fire off a window resize event to force RTE to refit the editor to its new bounds.
        }
    });
});
