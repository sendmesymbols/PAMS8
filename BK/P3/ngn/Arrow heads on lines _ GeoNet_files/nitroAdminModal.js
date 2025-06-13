// This file was automatically generated from nitroAdminModal.soy.
// Please don't edit this file by hand.

goog.provide('jive.nitro.admin.nitroAdminModal');

goog.require('soy');
goog.require('soydata');
goog.require('soy.StringBuilder');


jive.nitro.admin.nitroAdminModal = function(opt_data, opt_sb) {
  var output = opt_sb || new soy.StringBuilder();
  output.append('<div class="jive-modal" id="jive-nitro-admin-modal"><header><h2 class="jive-modal-title">', soy.$$escapeHtml(jive.i18n.i18nText(jive.i18n.getMsg('p794'),[])), '</h2></header><a class="j-modal-close-top jive-close close" href="#">', soy.$$escapeHtml(jive.i18n.i18nText(jive.i18n.getMsg('k1e90'),[])), ' <span class="j-close-icon j-ui-elem"></span></a><section class="jive-modal-content clearfix"><iframe src="', soy.$$escapeHtml(opt_data.baseUrl), '/?userName=', soy.$$escapeHtml(opt_data.username), '&password=', soy.$$escapeHtml(opt_data.password), '&autoLogin=true&mode=', soy.$$escapeHtml(opt_data.mode), '">', soy.$$escapeHtml(jive.i18n.i18nText(jive.i18n.getMsg('p794'),[])), '</iframe></section></div>');
  return opt_sb ? '' : output.toString();
};
