// This file was automatically generated from placeLinkPopoverResults.soy.
// Please don't edit this file by hand.

goog.provide('jive.shared.breadcrumb.placeLinkPopoverResults');

goog.require('soy');
goog.require('soydata');
goog.require('soy.StringBuilder');


jive.shared.breadcrumb.placeLinkPopoverResults = function(opt_data, opt_sb) {
  var output = opt_sb || new soy.StringBuilder();
  output.append('<ul class="j-icon-list">');
  if (opt_data.places.length > 0) {
    var placeList6 = opt_data.places;
    var placeListLen6 = placeList6.length;
    for (var placeIndex6 = 0; placeIndex6 < placeListLen6; placeIndex6++) {
      var placeData6 = placeList6[placeIndex6];
      output.append('<li class="j-shared-place-link">', (placeData6.name) ? '<a href="' + soy.$$escapeHtmlAttribute(soy.$$filterNormalizeUri(jive.soy.func.buildUrl(window._jive_base_url, placeData6.resources.html.ref))) + '" class="j-shared-place js-shared-place-link"><span class="jive-icon-big ' + soy.$$escapeHtmlAttribute(placeData6.iconCss) + ' js-place-link-popover-icon"></span><span class="lnk js-place-link-popover-name">' + soy.$$escapeHtml(placeData6.name) + '</span></a>' : '<span>' + soy.$$escapeHtml(jive.i18n.i18nText(jive.i18n.getMsg('k162f'),[])) + '</span>', (placeData6.canDeletePlaceRelationship) ? '<a href="#" class="js-remove-rel-confirm j-remove-share font-color-meta" title="' + soy.$$escapeHtmlAttribute(jive.i18n.i18nText(jive.i18n.getMsg('k1639'),[])) + '"' + soy.$$filterHtmlAttributes(jive.i18n.i18nText(jive.i18n.getMsg('k1639'),[])) + ' data-relationship-id="' + soy.$$escapeHtmlAttribute(placeData6.contentPlaceRelationshipID) + '"><span>' + soy.$$escapeHtml(jive.i18n.i18nText(jive.i18n.getMsg('k1639'),[])) + '</span></a>' : '', '</li>');
    }
    if (opt_data.placeLinkCount - opt_data.places.length > 0) {
      switch (opt_data.placeLinkCount - opt_data.places.length) {
        case 0:
          break;
        case 1:
          output.append('<li><span>', soy.$$escapeHtml(jive.i18n.i18nText(jive.i18n.getMsg('k162e'),[opt_data.placeLinkCount - opt_data.places.length])), '</span></li>');
          break;
        case 2:
          output.append('<li><span>', soy.$$escapeHtml(jive.i18n.i18nText(jive.i18n.getMsg('k1631'),[opt_data.placeLinkCount - opt_data.places.length])), '</span></li>');
          break;
        case 3:
          output.append('<li><span>', soy.$$escapeHtml(jive.i18n.i18nText(jive.i18n.getMsg('k1630'),[opt_data.placeLinkCount - opt_data.places.length])), '</span></li>');
          break;
        default:
          output.append('<li>', soy.$$escapeHtml(jive.i18n.i18nText(jive.i18n.getMsg('k162d'),[opt_data.placeLinkCount - opt_data.places.length])), '</li>');
      }
    }
  } else {
    output.append('<li>', (opt_data.placeLinkCount == 1) ? soy.$$escapeHtml(jive.i18n.i18nText(jive.i18n.getMsg('k1633'),[])) : soy.$$escapeHtml(jive.i18n.i18nText(jive.i18n.getMsg('k1632'),[])), '</li>');
  }
  output.append('</ul>');
  return opt_sb ? '' : output.toString();
};
