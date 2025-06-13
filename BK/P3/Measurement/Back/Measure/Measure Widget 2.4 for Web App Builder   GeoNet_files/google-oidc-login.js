define([
    'jiverscripts/oo/class'
], function(Class) {
    /**
     * @allowDependsWildcard
     * @depends template=jive.googleoidc.login.*
     */
    return Class.extend(function (protect) {

        protect.init = function (options) {
            var main = this;
            main.options = options;
        };

        this.signIn = function () {
            var main = this;

            window.location.href = 'https://accounts.google.com/o/oauth2/auth?scope=' +
            'email&' +
            'state=' + main.options.jiveTokenGUID + '&' +
            'response_type=code&' +
            'redirect_uri=' + main.options.redirectURI + '&'+
            'client_id=' + main.options.clientID + '&' +
            'openid.realm=' + main.options.openIDRealm;

            return true;
        };

    });
});
