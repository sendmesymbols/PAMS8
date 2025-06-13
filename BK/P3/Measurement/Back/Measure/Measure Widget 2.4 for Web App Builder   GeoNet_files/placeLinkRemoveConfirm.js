// This file was automatically generated from placeLinkRemoveConfirm.soy.
// Please don't edit this file by hand.

goog.provide('jive.shared.breadcrumb.placeLinkRemoveConfirm');

goog.require('soy');
goog.require('soydata');
goog.require('soy.StringBuilder');


jive.shared.breadcrumb.placeLinkRemoveConfirm = function(opt_data, opt_sb) {
  var output = opt_sb || new soy.StringBuilder();
  output.append('<div class="j-remove-share-confirm">', (opt_data.placeLink && opt_data.placeIconCss && opt_data.placeName) ? '<p>' + soy.$$escapeHtml(jive.i18n._i18n('57b5d4',[])) + '&nbsp;</p><p class="clearfix"><a href="' + soy.$$escapeHtmlAttribute(soy.$$filterNormalizeUri(opt_data.placeLink)) + '"><span class="jive-icon-med ' + soy.$$escapeHtmlAttribute(opt_data.placeIconCss) + '"></span>' + soy.$$escapeHtml(opt_data.placeName) + '</a>' + soy.$$escapeHtml(jive.i18n._i18n('8c51b9',[])) + '</p>' : '<p>' + soy.$$escapeHtml(jive.i18n._i18n('e3f8a6',[])) + '</p>', '<a href="#" class="js-remove-rel j-remove-rel-confirm j-btn-global" data-relationship-id="', soy.$$escapeHtmlAttribute(opt_data.relationshipID), '" data-command="deleteContentPlaceRelBreadcrumb" >', soy.$$escapeHtml(jive.i18n._i18n('119ac7',[])), '</a><a href="#" class="js-remove-rel-cancel j-remove-rel-confirm close j-btn-global">', soy.$$escapeHtml(jive.i18n._i18n('586877',[])), '</a></div>');
  return opt_sb ? '' : output.toString();
};
