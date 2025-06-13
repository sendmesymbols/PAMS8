// This file was automatically generated from outdatedWarning.soy.
// Please don't edit this file by hand.

goog.provide('jive.unified.content.view.outdatedWarning');

goog.require('soy');
goog.require('soydata');
goog.require('soy.StringBuilder');


jive.unified.content.view.outdatedWarning = function(opt_data, opt_sb) {
  opt_data = opt_data || {};
  var output = opt_sb || new soy.StringBuilder();
  output.append('<section class="j-content-outdated-message"><h1><span class="jive-icon-glyph icon-warning"></span>', soy.$$escapeHtml(jive.i18n._i18n('835530',[])), '</h1>', (opt_data.linkUrl) ? '<p>' + soy.$$escapeHtml(jive.i18n._i18n('37b860',[])) + ' <a href="' + soy.$$escapeHtml(opt_data.linkUrl) + '">' + soy.$$escapeHtml(opt_data.linkTitle) + '</a></p>' : '', '<button id="dismissOutdatedModal" class="j-content-outdated-button">', soy.$$escapeHtml(jive.i18n._i18n('67b203',[])), '</button></section>');
  return opt_sb ? '' : output.toString();
};
