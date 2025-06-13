// This file was automatically generated from renderUserRating.soy.
// Please don't edit this file by hand.

goog.provide('jive.rate.soy.renderUserRating');

goog.require('soy');
goog.require('soydata');
goog.require('soy.StringBuilder');


jive.rate.soy.renderUserRating = function(opt_data, opt_sb) {
  var output = opt_sb || new soy.StringBuilder();
  output.append('<div class="jive-content-userrating jive-content-myrating-print"><div class="j-rating-container clearfix"><div class="j-rating clearfix"><div class="jive-content-userrating-title">', soy.$$escapeHtml(opt_data.i18n.myRatingLabel), ' <span class="jive-content-userrating-desc">', soy.$$escapeHtml(opt_data.ratingDescription), '</span></div><div class="jive-content-userrating-score">');
  var availableRatingList8 = opt_data.ratingInfo.availableRatings;
  var availableRatingListLen8 = availableRatingList8.length;
  for (var availableRatingIndex8 = 0; availableRatingIndex8 < availableRatingListLen8; availableRatingIndex8++) {
    var availableRatingData8 = availableRatingList8[availableRatingIndex8];
    output.append('<a href="javascript:void(0);" class="jive-icon-userrating-', soy.$$escapeHtml(availableRatingData8.score), ' jive-icon-med jive-icon-rate-usr-', (opt_data.userRating >= availableRatingData8.score) ? 'on' : 'off', '" aria-labelledby="button-score-label-', soy.$$escapeHtml(availableRatingData8.score), '" role="button" aria-pressed="', (opt_data.userRating == availableRatingData8.score) ? 'true' : 'false', '"><span id="button-score-label-', soy.$$escapeHtml(availableRatingData8.score), '" class="j-508-label">', soy.$$escapeHtml(jive.i18n.i18nText(jive.i18n.getMsg(opt_data.i18n.rateRatingRate),[availableRatingData8.description,availableRatingData8.score,opt_data.ratingInfo.availableRatings.length])), '</span></a>');
  }
  output.append('<div class="jive-content-userrating-saved" style="display: none;" role="status"></div></div></div><div class="j-rating-comment-instruct"><p class="font-color-okay" role="status"><strong>', soy.$$escapeHtml(opt_data.i18n.rateRatingSaved), '</strong></p>', (opt_data.commentable) ? '<p class="font-color-meta"><a href="#" class="j-comment-on-rating"><strong>' + soy.$$escapeHtml(opt_data.i18n.writeAReview) + '</strong></a></p>' : '', '</div></div></div><div class="j-rating-comment"><ul class="jive-comment"><li><div class="jive-comment-arrow"></div><div class="jive-comment-content"><p class="jive-comment-meta font-color-meta-light">', soy.$$escapeHtml(opt_data.i18n.commentOnRating), '</p><div class="jive-rating-comment-body"> </div></div></li></ul></div>');
  return opt_sb ? '' : output.toString();
};
