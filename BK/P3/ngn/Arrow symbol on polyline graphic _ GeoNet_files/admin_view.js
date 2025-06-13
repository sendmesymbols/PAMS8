/*
 * Copyright (C) 1999-2015 Jive Software. All rights reserved.
 *
 * This software is the proprietary information of Jive Software. Use is subject to license terms.
 */

define([
    'jquery',
    'jiverscripts/oo/class',
    'jiverscripts/conc/observable',
    'soy!jive.nitro.admin.nitroAdminModal',
    'jquery-plugin/jquery.lightbox_me'
], function($, Class, observable, nitroAdminModalTmpl) {
    return Class.extend(function (protect, _super) {
        observable(this);

        this.init = function (options) {
            var view = this;
            this.options = options;

            $(document).ready(function () {
                view.attachLinkHandler();
            });
        };

        protect.attachLinkHandler = function () {
            var view = this;

            $('body').on('click', '#jive-nav-link-nitro-admin', function (e) {
                view.emitP('nitroAdminLinkClicked').addCallback(function (config) {
                    $('#j-satNav-menu').trigger('close');
                    view.openModal(config);
                    e.preventDefault();
                }).addErrback(function () {
                    console.log('promise got an errback');
                });
            });
        };

        protect.openModal = function (config) {
            var view = this;

            if (!$('#jive-nitro-admin-modal').is(':visible')) {
                var modal = $(nitroAdminModalTmpl(config));
                $('body').append(modal);

                view.populateModal(modal.filter(':first'), function () {
                    // on close callback
                });
            }
        };

        protect.populateModal = function (modal, callback) {
            modal.lightbox_me({
                onClose: function () {
                    callback();
                    modal.remove();
                },
                scrollWithPage: false,
                centered: true,
                destroyOnClose: true,
                closeClick: false
            });
        };
    });
});
