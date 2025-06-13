// This file was automatically generated from detailsLinks.soy.
// Please don't edit this file by hand.

goog.provide('jive.outcomes.summary.detailsLinks');

goog.require('soy');
goog.require('soydata');
goog.require('soy.StringBuilder');


jive.outcomes.summary.detailsLinks = function(opt_data, opt_sb) {
  var output = opt_sb || new soy.StringBuilder();
  output.append((opt_data.outcome.note || opt_data.outcome.properties && opt_data.outcome.properties.approvers) ? '<div class="j-outcome-link-container"><a class="j-outcome-link-details js-outcome-link-details js-outcome-link" href="#" data-outcome-url="' + soy.$$escapeHtml(opt_data.outcome.resources.self.ref) + '">' + soy.$$escapeHtml(jive.i18n.i18nText(jive.i18n.getMsg('k277e'),[])) + '</a><a class="j-outcome-link-incontext js-outcome-link-incontext js-outcome-link" href="' + soy.$$escapeHtml(opt_data.contextUrl) + '" style="display:none;">' + soy.$$escapeHtml(jive.i18n.i18nText(jive.i18n.getMsg('k2786'),[])) + '</a></div>' : '');
  return opt_sb ? '' : output.toString();
};
