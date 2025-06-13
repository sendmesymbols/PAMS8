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
      output.append('<li class="j-shared-place-link">', (placeData6.name) ? '<a href="' + soy.$$escapeHtmlAttribute(soy.$$filterNormalizeUri(jive.soy.func.buildUrl(window._jive_base_url, placeData6.resources.html.ref))) + '" class="j-shared-place js-shared-place-link"><span class="jive-icon-big ' + soy.$$escapeHtmlAttribute(placeData6.iconCss) + ' js-place-link-popover-icon"></span><span class="lnk js-place-link-popover-name">' + soy.$$escapeHtml(placeData6.name) + '</span></a>' : '<span>' + soy.$$escapeHtml(jive.i18n._i18n('46292d',[])) + '</span>', (placeData6.canDeletePlaceRelationship) ? '<a href="#" class="js-remove-rel-confirm j-remove-share font-color-meta" title="' + soy.$$escapeHtmlAttribute(jive.i18n._i18n('c96d7a',[])) + '"' + soy.$$filterHtmlAttributes(jive.i18n._i18n('c96d7a',[])) + ' data-relationship-id="' + soy.$$escapeHtmlAttribute(placeData6.contentPlaceRelationshipID) + '"><span>' + soy.$$escapeHtml(jive.i18n._i18n('c96d7a',[])) + '</span></a>' : '', '</li>');
    }
    if (opt_data.placeLinkCount - opt_data.places.length > 0) {
      switch (opt_data.placeLinkCount - opt_data.places.length) {
        case 0:
          break;
        case 1:
          output.append('<li><span>', soy.$$escapeHtml(jive.i18n._i18n('030f58',[opt_data.placeLinkCount - opt_data.places.length])), '</span></li>');
          break;
        case 2:
          output.append('<li><span>', soy.$$escapeHtml(jive.i18n._i18n('e3bafd',[opt_data.placeLinkCount - opt_data.places.length])), '</span></li>');
          break;
        case 3:
          output.append('<li><span>', soy.$$escapeHtml(jive.i18n._i18n('4f6da1',[opt_data.placeLinkCount - opt_data.places.length])), '</span></li>');
          break;
        default:
          output.append('<li>', soy.$$escapeHtml(jive.i18n._i18n('b8e3ca',[opt_data.placeLinkCount - opt_data.places.length])), '</li>');
      }
    }
  } else {
    output.append('<li>', (opt_data.placeLinkCount == 1) ? soy.$$escapeHtml(jive.i18n._i18n('d24809',[])) : soy.$$escapeHtml(jive.i18n._i18n('f1ed5b',[])), '</li>');
  }
  output.append('</ul>');
  return opt_sb ? '' : output.toString();
};
