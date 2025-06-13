define([
    'jquery',
    'apps/shared/controllers/localexchange',
    './renderedContent',
    'jquery-plugin/jquery.lightbox_me',
    'jive/namespace'
], function($, localExchange) {
    jive.namespace('rte');

    jive.rte.ExternalLinkModal = (function(enabled, whiteList) {
        if (enabled != 'true') {
            return;
        }
        if (whiteList == null) {
            whiteList = '';
        }

        var removeProtocolRegex = /^(?:[^\/]*\/\/(?:www\.)*)([^\/]*)/;
        var openInNewWindowGetURLRegex = /^(.*)external-link.jspa\?url=(.*)/;
        var parts = whiteList.split(/\b,+/);
        var whiteListedDomains = [];

        //build the whitelist from the system property
        if (whiteList != '') {
            $.each(parts, function() {
                var parsed = removeProtocolRegex.exec(this);
                if (parsed != null) {
                    whiteListedDomains.push(parsed[1]);
                } else {
                    whiteListedDomains.push(this);
                }
            });
        }

        //add the Jive site URL to the whitelist
        var match = removeProtocolRegex.exec(window.location.toString());
        if (match == null) {
            console.log('Error: could not parse href: ' + window.location.toString());
        } else {
            whiteListedDomains.push(match[1]);
        }

        localExchange.addListener('renderedContentWithSelector', handleExternalLinks);
        localExchange.addListener('carouselWidgetDrawn', handleExternalLinks);

        $('.js-exstorage-link').on('click', handleExternalLink);

        function handleExternalLink(e) {
            var noProtocol = removeProtocolRegex.exec($.trim(this.href))[1];
            var foundMatch = false;
            var urlRedirectingTo = this.href;
            var newWindow = false;

            if (this.href.indexOf('external-link.jspa') == -1) {
                //open in new window feature disabled
                $.each(whiteListedDomains, function() {
                    if (noProtocol.indexOf(this) == 0) {
                        foundMatch = true;
                        return false;
                    }
                });
            } else {
                //open in new window feature enabled, url is present in external-link.jspa?url=xxxx
                newWindow = true;
                urlRedirectingTo = decodeURIComponent(openInNewWindowGetURLRegex.exec($.trim(this.href))[2]);
                noProtocol = removeProtocolRegex.exec($.trim(urlRedirectingTo))[1];
                $.each(whiteListedDomains, function() {
                    if (noProtocol.indexOf(this) == 0) {
                        foundMatch = true;
                        return false;
                    }
                });
            }
            if (!foundMatch) {
                var truncated = urlRedirectingTo.substring(0, 34);
                if (truncated != urlRedirectingTo) {
                    truncated += '...';
                }
                $.get(_jive_base_url + '/external-link-capture.jspa', {
                    url: urlRedirectingTo,
                    linkText: truncated,
                    openInNewWindow: newWindow
                }, externalLinkModal);
                e.preventDefault();
            }
        }

        function handleExternalLinks($renderedContent) {
            $renderedContent.find('a').each(function() {
                $(this).on('click', handleExternalLink);
            });
        }


        function externalLinkModal(data) {
            var $lb = $('<div/>', {
                'class': 'jive-modal j-modal',
                'id': 'js-modalized'
            }).css({
                width: '450px'
            });
            var htmlAndScripts = jive.util.separateScripts(data);
            var scripts = htmlAndScripts[1];

            $lb.html(htmlAndScripts[0]);
            $lb.lightbox_me({
                destroyOnClose: true,
                centered: true
            });
            scripts();
        }
    });

    return jive.rte.ExternalLinkModal;
});
