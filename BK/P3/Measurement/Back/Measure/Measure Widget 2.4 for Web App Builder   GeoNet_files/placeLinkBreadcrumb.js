// This file was automatically generated from placeLinkBreadcrumb.soy.
// Please don't edit this file by hand.

goog.provide('jive.shared.breadcrumb.placeLinkBreadcrumb');

goog.require('soy');
goog.require('soydata');
goog.require('soy.StringBuilder');
goog.require('jive.shared.breadcrumb.placeLinkPopover');


jive.shared.breadcrumb.placeLinkBreadcrumb = function(opt_data, opt_sb) {
  var output = opt_sb || new soy.StringBuilder();
  if (opt_data.placeLinkCount && opt_data.placeLinkCount > 0 && opt_data.linkedContentType && opt_data.linkedContentID) {
    output.append((opt_data.legacy) ? ((opt_data.place || opt_data.parents) ? ' ' + soy.$$escapeHtml(jive.i18n._i18n('b9ef1a',[])) + ' ' : '') + '<a href="#" class="js-place-linked-content-link">' + ((opt_data.placeLinkCount == 1) ? soy.$$escapeHtml(jive.i18n._i18n('8309b2',[opt_data.placeLinkCount])) : (opt_data.placeLinkCount == 2) ? soy.$$escapeHtml(jive.i18n._i18n('15021b',[opt_data.placeLinkCount])) : (opt_data.placeLinkCount == 3) ? soy.$$escapeHtml(jive.i18n._i18n('3d7264',[opt_data.placeLinkCount])) : soy.$$escapeHtml(jive.i18n._i18n('b910c6',[opt_data.placeLinkCount]))) + '</a>' : (opt_data.userContainer) ? '<span>' + ((opt_data.linkedContentType != 38) ? soy.$$escapeHtml(jive.i18n._i18n('b9ef1a',[])) : '') + ' <a href="#" class="js-place-linked-content-link">' + ((opt_data.placeLinkCount == 1) ? soy.$$escapeHtml(jive.i18n._i18n('a29ad7',[opt_data.placeLinkCount])) : (opt_data.placeLinkCount == 2) ? soy.$$escapeHtml(jive.i18n._i18n('2b9dd2',[opt_data.placeLinkCount])) : (opt_data.placeLinkCount == 3) ? soy.$$escapeHtml(jive.i18n._i18n('b185d6',[opt_data.placeLinkCount])) : soy.$$escapeHtml(jive.i18n._i18n('c75498',[opt_data.placeLinkCount]))) + '</a>' + soy.$$escapeHtml(jive.i18n._i18n('0b3fc8',[])) + '</span>' : '<span> ' + soy.$$escapeHtml(jive.i18n._i18n('7b9e65',[])) + ' <a href="#" class="js-place-linked-content-link">' + ((opt_data.placeLinkCount == 1) ? soy.$$escapeHtml(jive.i18n._i18n('c1af5c',[opt_data.placeLinkCount])) : (opt_data.placeLinkCount == 2) ? soy.$$escapeHtml(jive.i18n._i18n('60387c',[opt_data.placeLinkCount])) : (opt_data.placeLinkCount == 3) ? soy.$$escapeHtml(jive.i18n._i18n('856218',[opt_data.placeLinkCount])) : soy.$$escapeHtml(jive.i18n._i18n('32ed3d',[opt_data.placeLinkCount]))) + '</a></span>');
    if (opt_data.renderPopoverContainer) {
      jive.shared.breadcrumb.placeLinkPopover(null, output);
    }
  }
  return opt_sb ? '' : output.toString();
};
