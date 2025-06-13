// This file was automatically generated from rollupReply.soy.
// Please don't edit this file by hand.

goog.provide('jive.outcomes.summary.rollupReply');

goog.require('soy');
goog.require('soydata');
goog.require('soy.StringBuilder');
goog.require('jive.outcomes.badge.badgeByline');
goog.require('jive.outcomes.helpful.msgHelpfulCount');
goog.require('jive.outcomes.summary.avatar');
goog.require('jive.outcomes.summary.detailsLinks');
goog.require('jive.shared.displayutil.avatar');
goog.require('jive.shared.displayutil.userDisplayNameLink');


jive.outcomes.summary.rollupReply = function(opt_data, opt_sb) {
  var output = opt_sb || new soy.StringBuilder();
  output.append('<div class="j-outcome-badge-popup">');
  jive.outcomes.summary.detailsLinks({outcome: opt_data.reply.outcomes[opt_data.outcomeTypeName], contextUrl: opt_data.reply.resources.html.ref}, output);
  jive.outcomes.badge.badgeByline({outcomeTypeName: opt_data.outcomeTypeName, author: opt_data.reply.outcomes[opt_data.outcomeTypeName].user, modifiedDate: opt_data.reply.outcomes[opt_data.outcomeTypeName].updated}, output);
  output.append('<div class="j-outcome-details js-outcome-details" style="display:none;"></div></div><div class="j-outcome-rollup-reply"><div class="j-outcome-reply-avatar">');
  if (opt_data.reply.author) {
    jive.outcomes.summary.avatar({user: opt_data.reply.author}, output);
  } else {
    jive.shared.displayutil.avatar({anonymous: true, enabled: true, partner: false, username: 'guest', id: 0, ID: 0, displayName: '', visible: true, prop: null, avatarID: 0, size: 32}, output);
  }
  output.append('</div><div class="j-outcome-reply-box"><p class="j-outcome-reply-byline jive-comment-meta font-color-meta">');
  if (opt_data.reply.author) {
    jive.shared.displayutil.userDisplayNameLink(soy.$$augmentMap(opt_data.reply.author, {anonymous: false}), output);
  } else {
    jive.shared.displayutil.userDisplayNameLink({anonymous: true, enabled: true, username: 'guest', id: 0, displayName: '', visible: true}, output);
  }
  output.append(' <a href="', soy.$$escapeHtml(opt_data.reply.resources.html.ref), '" class="j-outcome-reply-date font-color-normal js-outcome-reply-incontext">', soy.$$escapeHtml(((opt_data.reply.updated ? require('jive/model/date').DateUtil.parseISODateTime(opt_data.reply.updated) : '') ? require('moment')((parseFloat((opt_data.reply.updated ? require('jive/model/date').DateUtil.parseISODateTime(opt_data.reply.updated) : '')) ? parseFloat((opt_data.reply.updated ? require('jive/model/date').DateUtil.parseISODateTime(opt_data.reply.updated) : '')) : (opt_data.reply.updated ? require('jive/model/date').DateUtil.parseISODateTime(opt_data.reply.updated) : ''))).locale(_jive_locale.toLowerCase().replace('_','-')).format('lll') : '')), '<span class="j-in-context font-color-meta-light"> (', soy.$$escapeHtml(jive.i18n.i18nText(jive.i18n.getMsg('k2786'),[])), ')</span></a>');
  if (opt_data.reply.helpfulCount) {
    output.append('<span style="float:right;">');
    if (! opt_data.reply.unhelpfulCount) {
      jive.outcomes.helpful.msgHelpfulCount({helpfulCount: opt_data.reply.helpfulCount, overallCount: opt_data.reply.helpfulCount, displayOverall: false}, output);
    } else {
      jive.outcomes.helpful.msgHelpfulCount({helpfulCount: opt_data.reply.helpfulCount, overallCount: opt_data.reply.helpfulCount + opt_data.reply.unhelpfulCount, displayOverall: true}, output);
    }
    output.append('</span>');
  }
  output.append('</p><div class="j-outcome-reply-body js-outcome-reply-body">', soy.$$filterNoAutoescape(opt_data.reply.content.text), '</div><div class="j-outcome-more js-outcome-more" style="display:none;"><a class="j-rc3 font-color-meta" href=\'#\'>', soy.$$escapeHtml(jive.i18n.i18nText(jive.i18n.getMsg('k1f54'),[])), '</a></div></div></div>');
  return opt_sb ? '' : output.toString();
};
