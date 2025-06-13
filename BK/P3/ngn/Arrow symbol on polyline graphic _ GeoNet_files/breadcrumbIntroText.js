// This file was automatically generated from breadcrumbIntroText.soy.
// Please don't edit this file by hand.

goog.provide('jive.shared.breadcrumb.breadcrumbIntroText');

goog.require('soy');
goog.require('soydata');
goog.require('soy.StringBuilder');
goog.require('jive.shared.soy.i18nHelper');


jive.shared.breadcrumb.breadcrumbIntroText = function(opt_data, opt_sb) {
  var output = opt_sb || new soy.StringBuilder();
  if (opt_data.hasRelationships) {
    jive.shared.soy.i18nHelper({i18nKey: soy.$$escapeHtml(jive.i18n.getMinKey(opt_data.messageKey)), arg0: '<a href="' + soy.$$escapeHtmlAttribute(soy.$$filterNormalizeUri(opt_data.containerUrl)) + '"><span class="' + soy.$$escapeHtmlAttribute(opt_data.containerCss) + '"></span>' + soy.$$escapeHtml(opt_data.containerName) + '</a>', noAutoEscape: true}, output);
  } else {
    jive.shared.soy.i18nHelper({i18nKey: soy.$$escapeHtml(jive.i18n.getMinKey(opt_data.messageKey)), arg0: (opt_data.browseFromRootSpace) ? '<a href="' + ((opt_data.browseFilter) ? soy.$$escapeHtmlAttribute(soy.$$filterNormalizeUri(opt_data.browseFilter)) : '') + '">' : '<a href="' + soy.$$escapeHtmlAttribute(soy.$$filterNormalizeUri(opt_data.containerUrl)) + ((opt_data.browseFilter) ? soy.$$escapeHtmlAttribute(opt_data.browseFilter) : '') + '">', arg1: '</a>', arg2: '<a href="' + soy.$$escapeHtmlAttribute(soy.$$filterNormalizeUri(opt_data.containerUrl)) + '"><span class="' + soy.$$escapeHtmlAttribute(opt_data.containerCss) + '"></span>' + soy.$$escapeHtml(opt_data.containerName) + '</a>', noAutoEscape: true}, output);
  }
  return opt_sb ? '' : output.toString();
};
