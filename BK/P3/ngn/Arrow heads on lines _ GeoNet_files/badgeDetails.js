// This file was automatically generated from badgeDetails.soy.
// Please don't edit this file by hand.

goog.provide('jive.outcomes.badge.badgeByline');
goog.provide('jive.outcomes.badge.badgeDetails');

goog.require('soy');
goog.require('soydata');
goog.require('soy.StringBuilder');
goog.require('jive.outcomes.badge.badgeAlertedNames');
goog.require('jive.shared.displayutil.userDisplayNameLink');


jive.outcomes.badge.badgeByline = function(opt_data, opt_sb) {
  var output = opt_sb || new soy.StringBuilder();
  output.append('<div class="j-outcome-byline">', soy.$$escapeHtml(jive.i18n.i18nText(jive.i18n.getMsg(jive.i18n.getMinKey('outcomes.badge.popup.' + opt_data.outcomeTypeName)),[])), ' ');
  jive.shared.displayutil.userDisplayNameLink(soy.$$augmentMap(opt_data.author, {anonymous: false}), output);
  output.append(' <span class="font-color-meta">', soy.$$escapeHtml(jive.i18n.i18nText(jive.i18n.getMsg('k2751'),[((opt_data.modifiedDate ? require('jive/model/date').DateUtil.parseISODateTime(opt_data.modifiedDate) : '') ? require('moment')((parseFloat((opt_data.modifiedDate ? require('jive/model/date').DateUtil.parseISODateTime(opt_data.modifiedDate) : '')) ? parseFloat((opt_data.modifiedDate ? require('jive/model/date').DateUtil.parseISODateTime(opt_data.modifiedDate) : '')) : (opt_data.modifiedDate ? require('jive/model/date').DateUtil.parseISODateTime(opt_data.modifiedDate) : ''))).locale(_jive_locale.toLowerCase().replace('_','-')).format('lll') : '')])), '</span></div>');
  return opt_sb ? '' : output.toString();
};


jive.outcomes.badge.badgeDetails = function(opt_data, opt_sb) {
  opt_data = opt_data || {};
  var output = opt_sb || new soy.StringBuilder();
  output.append((opt_data.comment) ? '<div class="j-outcome-comment"><strong class="font-color-meta">' + soy.$$escapeHtml(jive.i18n.i18nText(jive.i18n.getMsg('k2755'),[])) + '</strong> ' + soy.$$changeNewlineToBr(soy.$$escapeHtml(opt_data.comment)) + '</div>' : '');
  if (opt_data.alertedNames) {
    jive.outcomes.badge.badgeAlertedNames(opt_data, output);
  }
  return opt_sb ? '' : output.toString();
};
