// This file was automatically generated from rollup.soy.
// Please don't edit this file by hand.

goog.provide('jive.outcomes.summary.rollup');

goog.require('soy');
goog.require('soydata');
goog.require('soy.StringBuilder');
goog.require('jive.outcomes.badge.badgeRaw');
goog.require('jive.outcomes.summary.rollupReply');


jive.outcomes.summary.rollup = function(opt_data, opt_sb) {
  var output = opt_sb || new soy.StringBuilder();
  output.append('<div class="j-outcome-rollup jive-modal-wide"><h3 class="j-outcome-rollup-title">');
  jive.outcomes.badge.badgeRaw({tagName: 'span', outcomeType: opt_data.outcomeType, embedded: true}, output);
  output.append('<span class="j-outcome-rollup-title-text"> ', soy.$$filterNoAutoescape(opt_data.tloTitle), '</span></h3><div class="j-outcome-rollup-replies">');
  var replyList12 = opt_data.replies;
  var replyListLen12 = replyList12.length;
  for (var replyIndex12 = 0; replyIndex12 < replyListLen12; replyIndex12++) {
    var replyData12 = replyList12[replyIndex12];
    jive.outcomes.summary.rollupReply({reply: replyData12, outcomeTypeName: opt_data.outcomeType}, output);
  }
  output.append('</div><div class="j-outcome-done-block j-rc5 j-rc-none-top"><a href="#" class="js-outcome-done-button j-btn-global">', soy.$$escapeHtml(jive.i18n.i18nText(jive.i18n.getMsg('k277f'),[])), '</a></div></div>');
  return opt_sb ? '' : output.toString();
};
