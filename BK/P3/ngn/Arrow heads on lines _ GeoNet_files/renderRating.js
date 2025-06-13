// This file was automatically generated from renderRating.soy.
// Please don't edit this file by hand.

goog.provide('jive.rate.soy.renderRating');

goog.require('soy');
goog.require('soydata');
goog.require('soy.StringBuilder');


jive.rate.soy.renderRating = function(opt_data, opt_sb) {
  var output = opt_sb || new soy.StringBuilder();
  output.append('<div class="jive-content-avgrating" tabindex="0" aria-labelledby="j-rating-score"><span class="j-508-label" id="j-rating-score">', soy.$$escapeHtml(opt_data.i18n.avgUserRatingTitlei18n), ': ', (opt_data.ratingInfo.ratingCount > 0) ? soy.$$escapeHtml(jive.i18n.i18nText(jive.i18n.getMsg(opt_data.i18n.rateAmount),[opt_data.ratingInfo.meanRating,opt_data.ratingInfo.availableRatings.length])) : soy.$$escapeHtml(opt_data.i18n.rateRatingsNone), ' (', soy.$$escapeHtml(opt_data.ratingInfo.ratingCount), ' ', (opt_data.ratingInfo.ratingCount == 1) ? soy.$$escapeHtml(opt_data.i18n.rateRatingLabel) : soy.$$escapeHtml(opt_data.i18n.rateRatingsLabel), ')</span><div class="jive-content-avgrating-title">', soy.$$escapeHtml(opt_data.i18n.avgUserRatingTitlei18n), '</div><div class="jive-content-avgrating-score" title="', soy.$$escapeHtml(jive.i18n.i18nText(jive.i18n.getMsg(opt_data.i18n.rateAmountComplete),[opt_data.ratingInfo.meanRating,opt_data.ratingInfo.availableRatings.length])), '"><span class="j-508-label">', (opt_data.ratingInfo.ratingCount > 0) ? soy.$$escapeHtml(jive.i18n.i18nText(jive.i18n.getMsg(opt_data.i18n.rateAmountComplete),[opt_data.ratingInfo.meanRating,opt_data.ratingInfo.availableRatings.length])) : soy.$$escapeHtml(opt_data.i18n.rateRatingsNone), '</span>');
  var availableRatingList30 = opt_data.ratingInfo.availableRatings;
  var availableRatingListLen30 = availableRatingList30.length;
  for (var availableRatingIndex30 = 0; availableRatingIndex30 < availableRatingListLen30; availableRatingIndex30++) {
    var availableRatingData30 = availableRatingList30[availableRatingIndex30];
    output.append('<span class="jive-icon-avgrating-', soy.$$escapeHtml(availableRatingData30.score), ' jive-icon-med jive-icon-rate-avg-', (opt_data.ratingInfo.meanRating >= availableRatingData30.score) ? 'on' : (opt_data.ratingInfo.meanRating >= availableRatingData30.score - 0.5) ? 'half' : 'off', '"></span>');
  }
  output.append('</div><div class="jive-content-rating-print" style="display: none;">', soy.$$escapeHtml(opt_data.ratingInfo.meanRating), '</div><div class="jive-content-avgrating-count">(', soy.$$escapeHtml(opt_data.ratingInfo.ratingCount), ' ', (opt_data.ratingInfo.ratingCount == 1) ? soy.$$escapeHtml(opt_data.i18n.rateRatingLabel) : soy.$$escapeHtml(opt_data.i18n.rateRatingsLabel), ')</div></div>');
  return opt_sb ? '' : output.toString();
};
