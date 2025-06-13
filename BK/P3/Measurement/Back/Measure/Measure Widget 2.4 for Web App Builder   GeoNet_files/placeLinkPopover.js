// This file was automatically generated from placeLinkPopover.soy.
// Please don't edit this file by hand.

goog.provide('jive.shared.breadcrumb.placeLinkPopover');

goog.require('soy');
goog.require('soydata');
goog.require('soy.StringBuilder');


jive.shared.breadcrumb.placeLinkPopover = function(opt_data, opt_sb) {
  var output = opt_sb || new soy.StringBuilder();
  output.append('<span id="js-place-linked-content-container-placeholder"></span><div id="js-place-linked-content-container" class="j-pop-main j-place-linked-content-container js-place-linked-content-container" style="display: none"></div>');
  return opt_sb ? '' : output.toString();
};
