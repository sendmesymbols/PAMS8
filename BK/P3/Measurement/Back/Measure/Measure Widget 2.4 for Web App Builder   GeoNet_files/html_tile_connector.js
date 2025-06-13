define(['jquery', 'underscore'], function($, _) {
    'use strict';
    var listening = false;


    /**
     * Communicates the ready event to the tile
     * @param {Window} source
     */
    function handleOnReady(source) {
        source.postMessage('ready', '*');
    }

    /**
     * Responds to resize requests from the tile
     *
     * @param {Window} source
     * @param {Object} payload
     * @param {Number} payload.height
     * @param {Number} payload.width
     */
    function handleResize(source, payload) {
        // shim the transaction object
        var transaction = {
            resolve: $.noop,
            node: {
                frame: _.find($('iframe').toArray(), function (frame) {
                    return frame.contentWindow === source;
                })
            }
        };

        require(['jive/gala/gadgets'], (function (gadgets) {
            if (payload.height > 0) {
                gadgets.resizeIframe(transaction, payload);
            }
            else if (payload.width > 0) {
                gadgets.resizeIframeWidth(transaction, payload);
            }
        }));
    }


    return {
        /**
         * Begins listening to messages from tiles.  Only executes one time.
         */
        listen: function() {
            if (!listening) {
                listening = true;

                $(window).on('message', function (e) {
                    try {
                        var data = e.originalEvent.data;
                        var source = e.originalEvent.source;
                        if (_.isString(data) && _.startsWith(data, '{')) {
                            data = JSON.parse(data);
                        }

                        switch (data.command) {
                            case 'HTMLTile:ready':
                                handleOnReady(source);
                                break;

                            case 'HTMLTile:resizeIframe':
                                handleResize(source, data.payload);
                                break;
                        }
                    } catch (e) {}
                });
            }
        }
    }
});
