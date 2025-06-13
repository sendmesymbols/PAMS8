/*
 * $Revision$
 * $Date$
 *
 * Copyright (C) 1999-2015 Jive Software. All rights reserved.
 *
 * This software is the proprietary information of Jive Software. Use is subject to license terms.
 */

/**
 * This is a noop mock for the entry point for the JAF.CoreContainer.Main class.
 *
 */
define([
    'jiverscripts/oo/class',
    'jiverscripts/conc/observable'
], function(Class, observable) {
    var Main = Class.extend(function(protect) {
        // Mix in observable to make this class an event emitter.
        observable(this);

        this.init = function(options) {};

        /*
         * Called whenever a content is created or edited
         */
        this.initEditContext = function(contentBean) {};

        /**
         * This function will load the canvas view javascript. In defines an anonymous AMD module that will cause the
         * Javascript to be loaded via ajax at call time. See https://brewspace.jiveland.com/docs/DOC-78139 for more
         * information on how this works.
         * @param viewMetaData
         */
        this.renderCanvasView = function(viewMetaData) {};

        /**
         * An app action was selected in RTE the plug-in
         * @param jqLinkObject - obtain app info from this element
         * @param rteContext - add/replace properties from here to current rteContext
         * @param appActionDataPromise - the promise fulfilled once app creates the new artifact
         */
        this.handleRTEActionSelect = function(jqLinkObject, rteContext, appActionDataPromise) {
            appActionDataPromise.reject('Apps market disabled.');
        };

        /**
         * An app artifact is being edited in RTE
         * @param actionEntry - obtain app info from this element
         * @param rteContext - add/replace properties from here to current rteContext
         * @param currentArtifact - teh app artifact being edited
         * @param appActionDataPromise - the promise fulfilled once app creates the new artifact
         */
        this.handleRTEActionContextEdit = function(actionEntry, rteContext, currentArtifact, appActionDataPromise) {
            appActionDataPromise.reject('Apps market disabled.');
        };

        /**
         * Will be called to render apps market if core container fails to get the app instance for user based on app UUID.
         *
         * @param dataOrView An optional string to pass to the market to indicate
         *     initial context.
         * @param dataOrView.experience the experience string to coerce the market
         *     to the expected presentation
         * @param dataOrView.appUUID the app UUID the market should present
         * @param dataOrView.appFilter the app UUID the market should present
         * @param dataOrView.embeddedID the embedded artifact id, used to pass a
         *     proper Jive context.
         * @param dataOrView.view the gadget view to open the market in
         */
        this.handleMarketContext = function(dataOrView) {};

        /**
         * The object returned here is an instance of
         * jive.JAF.CoreContainer.MarketEvents and mixes in jive.conc.observable.
         * The returned object supports the method:
         * addListener(eventName, function(){...})
         */
        this.getMarketEvents = function() {
            return this;
        };
    });
    return Main;
});
