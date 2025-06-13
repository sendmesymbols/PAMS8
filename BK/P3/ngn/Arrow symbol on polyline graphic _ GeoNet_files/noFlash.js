// This file was automatically generated from noFlash.soy.
// Please don't edit this file by hand.

goog.provide('jive.videos.common.noFlash');

goog.require('soy');
goog.require('soydata');
goog.require('soy.StringBuilder');


jive.videos.common.noFlash = function(opt_data, opt_sb) {
  var output = opt_sb || new soy.StringBuilder();
  output.append('<div id=\'flash-not-installed\' class=\'flash-not-installed\'><h4><span class=\'jive-icon-med jive-icon-warn\'></span>', soy.$$escapeHtml(jive.i18n.i18nText(jive.i18n.getMsg('pa6c'),[])), ' ', soy.$$escapeHtml(jive.i18n.i18nText(jive.i18n.getMsg('k1e95'),[])), '</h4><p>', soy.$$escapeHtml(jive.i18n.i18nText(jive.i18n.getMsg('pa7f'),[])), '</p><p><a href=\'http://www.adobe.com/go/getflash\'> ', soy.$$escapeHtml(jive.i18n.i18nText(jive.i18n.getMsg('pa7e'),[])), '</a></p></div>');
  return opt_sb ? '' : output.toString();
};
