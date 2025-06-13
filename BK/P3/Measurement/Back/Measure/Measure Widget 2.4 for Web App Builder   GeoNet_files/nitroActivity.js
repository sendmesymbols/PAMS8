// This file was automatically generated from nitroActivity.soy.
// Please don't edit this file by hand.

goog.provide('jive.eae.digest.subItem.nitroActivity');

goog.require('soy');
goog.require('soydata');
goog.require('soy.StringBuilder');
goog.require('jive.eae.common.groupedUsers');
goog.require('jive.shared.displayutil.userDisplayNameLink');


jive.eae.digest.subItem.nitroActivity = function(opt_data, opt_sb) {
  var output = opt_sb || new soy.StringBuilder();
  if (opt_data.activity.groupedUsers && opt_data.activity.groupedUsers.length) {
    jive.eae.common.groupedUsers({groupedUserList: opt_data.activity.groupedUsers, user: opt_data.user, othersListLinkID: soy.$$escapeHtml(jive.soy.func.randomString()), groupAfterNum: 3}, output);
  } else {
    jive.shared.displayutil.userDisplayNameLink(soy.$$augmentMap(opt_data.activity.activityUser, {displayNameOverride: (opt_data.user.id == opt_data.activity.activityUser.id) ? soy.$$escapeHtml(jive.i18n._i18n('1798fd',[])) : ''}), output);
  }
  output.append(' <span class="j-nitro-activity"><a href="#" class="nitro-challenge-link" data-challenge-name="', soy.$$escapeHtml(encodeURIComponent(opt_data.activity.content.name)), '"><span class="j-nitro-activity-type">', soy.$$escapeHtml(opt_data.activity.content.plainSubject), '</span>', (opt_data.activity.content.imagePath) ? '<img src="' + soy.$$escapeHtml(opt_data.activity.content.imagePath) + '" class="j-nitro-activity-icon" alt="' + soy.$$escapeHtml(opt_data.activity.content.plainSubject) + '" title="' + soy.$$escapeHtml(opt_data.activity.content.plainSubject) + '"/>' : '', '<span class="j-nitro-activity-name">', soy.$$escapeHtml(opt_data.activity.content.body), '</span></a></span>');
  return opt_sb ? '' : output.toString();
};
