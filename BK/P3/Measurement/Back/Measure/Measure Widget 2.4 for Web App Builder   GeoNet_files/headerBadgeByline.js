// This file was automatically generated from headerBadgeByline.soy.
// Please don't edit this file by hand.

goog.provide('jive.unified.content.view.headerBadgeByline');

goog.require('soy');
goog.require('soydata');
goog.require('soy.StringBuilder');
goog.require('jive.shared.displayutil.userDisplayNameLink');


jive.unified.content.view.headerBadgeByline = function(opt_data, opt_sb) {
  var output = opt_sb || new soy.StringBuilder();
  output.append('<span class="j-outcome-byline font-color-meta">', soy.$$escapeHtml(jive.i18n._i18n(jive.i18n.getMinKey('outcomes.badge.popup.' + opt_data.outcomeTypeName),[])), ' ');
  jive.shared.displayutil.userDisplayNameLink(soy.$$augmentMap(opt_data.author, {anonymous: false}), output);
  output.append(' <span class="font-color-meta">', soy.$$escapeHtml(jive.i18n._i18n('b17b0f',[((opt_data.modifiedDate ? require('jive/model/date').DateUtil.parseISODateTime(opt_data.modifiedDate) : '') ? require('moment').utc(parseFloat((opt_data.modifiedDate ? require('jive/model/date').DateUtil.parseISODateTime(opt_data.modifiedDate) : '')) ? parseFloat((opt_data.modifiedDate ? require('jive/model/date').DateUtil.parseISODateTime(opt_data.modifiedDate) : '')) : (opt_data.modifiedDate ? require('jive/model/date').DateUtil.parseISODateTime(opt_data.modifiedDate) : '')).add(_jive_timezoneoffset * 60 * 60 * 1000).locale(_jive_locale.toLowerCase().replace('_','-')).format('lll') : '')])), '</span></span>');
  return opt_sb ? '' : output.toString();
};
