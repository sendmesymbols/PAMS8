/*
 * Copyright (C) 1999-2015 Jive Software. All rights reserved.
 *
 * This software is the proprietary information of Jive Software. Use is subject to license terms.
 */

define([
    'jquery',
    'url',
    'jiverscripts/oo/class',
    'jiverscripts/conc/promise'
], function($j, url, Class, Promise) {
    return Class.extend(function(protect, _super) {

        this.init = function(options) {
            this.options = options || {};
            this.methods = [];
            this.dfd = new $j.Deferred();

            this.dfd.done(this.setSession);

            if (this.options.hasOwnProperty('server')) {
                this.dfd.resolveWith(this, [this.options]);
            } else {
                this.loadSession();
            }
        };

        this.execute = function(callback) {
            var promise = new Promise();
            var self = this;

            this.dfd.done(function() {
                var methodString = this.generateAllMethodsString();

                $j.getJSON(self.serverUrl + encodeURIComponent(methodString), function(res) {
                    $j.extend(res, {
                        eachMethod: function(methodName, callback) {
                            self.eachMethod(res, methodName, callback);
                        }
                    });
                    self.handleNitroResponse(res, promise, callback);
                });
            });

            return promise;
        };

        this.addMethod = function(name, params) {
            this.methods.push(this.createMethodString(name, params));

            return this;
        };

        this.isLocalizationEnabled = function() {
            return this.localizationEnabled || false;
        };

        protect.eachMethod = function(res, methodName, callback) {
            $j.each(res.Nitro.Nitro, function(i, method) {
                if (method.method === methodName) {
                    callback.call(this, method);
                }
            });
        };

        protect.generateAllMethodsString = function() {
            this.methods.unshift(this.createMethodString('user.login', this.loginParameters));

            var methodString = '[' + this.methods.join(',') + ']';

            this.methods = [];

            return methodString;
        };

        protect.setSession = function(data) {
            this.serverUrl = (data.server || data.baseUrl) + '?jsCallback=?&method=batch.run&methodFeed=';
            this.localizationEnabled = data.localizationEnabled || false;
            this.loginParameters = {
                userId: data.userID,
                apiKey:  data.apiKey,
                ts: data.timeStamp,
                sig: data.signature
            };
        };

        protect.loadSession = function() {
            var self = this;

            $j.ajax({
                url: url.v2Url("/nitro/admin/session"),
                success: function(response) {
                    self.dfd.resolveWith(self, [response]);
                },
                error: function(jqXHR, textStatus, errorThrown) {
                    console.log('Error getting session: '+textStatus+'/'+errorThrown);
                    self.dfd.rejectWith(self, [textStatus, errorThrown]);
                }
            });
        };

        protect.handleNitroResponse = function(res, promise, callback) {
            var nitro = res.Nitro;
            if (typeof nitro.Error != "undefined") {
                promise.emitError(nitro.Error.Code, nitro.Error.Message);
            } else {
                var noErrors = true;
                $j.each(nitro.Nitro, function(i, method) {
                    if (typeof method.Error != "undefined") {
                        promise.emitError(method.Error.Code, method.Error.Message);
                        noErrors = false;
                    }
                });

                if (noErrors) {
                    callback.call(this, res, promise);
                }
            }
        };

        protect.createMethodString = function(name, params) {
            var result = '"method='+name;

            $j.each(params, function(key, value) {
                result += '&'+key+'='+value;
            });

            result += '"';

            return result;
        };

    });
});
