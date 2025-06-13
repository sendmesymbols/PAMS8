// This file was automatically generated from badge.soy.
// Please don't edit this file by hand.

goog.provide('jive.unified.content.view.badge');

goog.require('soy');
goog.require('soydata');
goog.require('soy.StringBuilder');


jive.unified.content.view.badge = function(opt_data, opt_sb) {
  var output = opt_sb || new soy.StringBuilder();
  output.append('<li class="js-outcome-badge j-outcome-badge js-outcome-type-', soy.$$escapeHtml(opt_data.outcomeType), ' j-outcome-type-', soy.$$escapeHtml(opt_data.outcomeType), ' js-outcomes-v2"', (opt_data.outcomeId) ? 'data-outcome="' + soy.$$escapeHtml(jive.soy.func.buildUrl(window._jive_base_absolute_url, '/api/core/v3/outcomes/' + opt_data.outcomeId)) + '"' : '', (opt_data.objectType && opt_data.objectId) ? 'data-ed=\'{"type":' + soy.$$escapeHtml(opt_data.objectType) + ', "id": ' + soy.$$escapeHtml(opt_data.objectId) + '}\'' : '', 'data-outcome-type="', soy.$$escapeHtml(opt_data.outcomeType), '"><a href="#" aria-haspopup="true">', soy.$$escapeHtml(jive.i18n._i18n(jive.i18n.getMinKey('outcomes.badge.v2.' + opt_data.outcomeType),[])), (opt_data.outcomeType != 'mostliked') ? '(' + soy.$$escapeHtml(opt_data.outcomeCount) + ')' : '', '</a></li>');
  return opt_sb ? '' : output.toString();
};
