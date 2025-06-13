// This file was automatically generated from summaryCount.soy.
// Please don't edit this file by hand.

goog.provide('jive.outcomes.summary.summaryCount');

goog.require('soy');
goog.require('soydata');
goog.require('soy.StringBuilder');
goog.require('jive.outcomes.badge.badgeRaw');


jive.outcomes.summary.summaryCount = function(opt_data, opt_sb) {
  var output = opt_sb || new soy.StringBuilder();
  output.append('<li class="js-outcome-summary-count j-outcome-summary-count js-outcome-type-', soy.$$escapeHtml(opt_data.outcomeType), ' j-outcome-type-', soy.$$escapeHtml(opt_data.outcomeType), '" tabindex="0" role="button" aria-haspopup="true" data-outcome-type="', soy.$$escapeHtml(opt_data.outcomeType), '" data-count="', soy.$$escapeHtml(opt_data.count), '" aria-label="', soy.$$escapeHtml(opt_data.outcomeType), '"><a class="js-outcome-count-block j-outcome-count-block" href="#"><span class="j-outcome-count">', soy.$$escapeHtml(opt_data.count), '</span>');
  jive.outcomes.badge.badgeRaw({outcomeType: opt_data.outcomeType, embedded: true, tagName: 'span'}, output);
  output.append('</a></li>');
  return opt_sb ? '' : output.toString();
};
