// This file was automatically generated from headerBadgePopup.soy.
// Please don't edit this file by hand.

goog.provide('jive.unified.content.view.headerBadgePopup');

goog.require('soy');
goog.require('soydata');
goog.require('soy.StringBuilder');
goog.require('jive.unified.content.view.headerBadgeByline');


jive.unified.content.view.headerBadgePopup = function(opt_data, opt_sb) {
  var output = opt_sb || new soy.StringBuilder();
  output.append('<div class="j-outcome-badge-popup j-outcome-popup j-outcome-meta">');
  if (! (opt_data.props.url && opt_data.props.title)) {
    jive.unified.content.view.headerBadgeByline(opt_data, output);
  }
  output.append('</div>');
  return opt_sb ? '' : output.toString();
};
