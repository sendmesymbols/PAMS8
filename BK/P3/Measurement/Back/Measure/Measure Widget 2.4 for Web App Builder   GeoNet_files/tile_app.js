/*
 * $Revision$
 * $Date$
 *
 * Copyright (C) 1999-2015 Jive Software. All rights reserved.
 *
 * This software is the proprietary information of Jive Software. Use is subject to license terms.
 */
/**
 * This is the entry point for the JAF.CoreContainer.Main class.
 * This singleton controller does not remember state of "current" app.
 * Information about the content in which the app is to appear is available in options.editedContentBean
 * after initEditContext is called.
 *
 * @class
 * @param {Object} options used to initialize the core container.
 *
 * @allowDependsWildcard
 * @depends template=jive.apps.alerts.* scope=client
 */
define([
    './shared',
    'osapi',
    'gadgets',
    'jquery'
], function(Shared, osapi, gadgets, $) {
    return Shared.extend(function(protect) {
        // register supported rpc events
        protect.rpcRegister = function() {};

        protect.initializeEventHandlers = function(ActionOriginEnum) {
            var main = this;

            // Add default listeners to all Modal View ActionOriginEnum
            $.each(ActionOriginEnum, function(index, origin) {
                main.modalView.addListener(origin, function(actionInfo) {
                    main.handleRunAction(actionInfo, origin);
                });
            });

            ////////////////////////////////////////////////////////////////////////////////////////////
            this.modalView.addListener('app.services.show', function(appUUID) {
                if (main.servicesView && main.servicesView.isActive()) return;
                if (main.servicesView) delete main.servicesView;
                if (appUUID) {
                    main.model.getApp(appUUID).addCallback(function(app) {
                        // get the app, and on retrieve setup the services view
                        main.servicesView = new AppServicesView(app, main.commonContainer, main.options);

                        main.servicesView.addListener('app.reload', function() {
                            main.reloadApp();
                        });

                        // fetch the market app
                        main.model.getAppsMarketApp().addCallback(function(marketApp) {
                            main.servicesView.setMarketApp(marketApp);

                            main.servicesView.addListener('app.services.close', function() {
                                main.modalView.destroySettings();
                                if (app.developerModel) {
                                    main.modalView.setSparkline(app.developerModel.getMonitorState());
                                }
                            });

                            main.modalView.invokeSettings(main.servicesView);
                        });
                    });
                }
            });

            ////////////////////////////////////////////////////////////////////////////////////////////
            this.modalView.addListener('app.chrome.close', function() {
                delete main.servicesView;
                if (main.credentialsView) {
                    main.credentialsView.cleanup();
                    delete main.credentialsView;
                }
                main.servicesView = null;
                main.credentialsView = null;
                main.oauthView = null;
            });

            $(document).ready(function() {
                main.modalView.documentReady();
            });
        };

    });
});
