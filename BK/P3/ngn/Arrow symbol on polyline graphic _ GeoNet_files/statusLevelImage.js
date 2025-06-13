// This file was automatically generated from statusLevelImage.soy.
// Please don't edit this file by hand.

goog.provide('jive.ps.nitro.content.statusLevelImage');

goog.require('soy');
goog.require('soydata');
goog.require('soy.StringBuilder');


jive.ps.nitro.content.statusLevelImage = function(opt_data, opt_sb) {
  var output = opt_sb || new soy.StringBuilder();
  output.append('<span class="j-status-levels j-gamification-status-level"><img src="', soy.$$escapeHtml(opt_data.imagePath), '" alt="', soy.$$escapeHtml(opt_data.title), '" title="', soy.$$escapeHtml(opt_data.title), '" /></span>');
  return opt_sb ? '' : output.toString();
};
