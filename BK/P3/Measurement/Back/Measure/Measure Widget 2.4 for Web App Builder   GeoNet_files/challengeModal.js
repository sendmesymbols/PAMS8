// This file was automatically generated from challengeModal.soy.
// Please don't edit this file by hand.

goog.provide('jive.nitro.challenges.challengeModal');

goog.require('soy');
goog.require('soydata');
goog.require('soy.StringBuilder');
goog.require('jive.soy.acclaim.renderUserList');


jive.nitro.challenges.challengeModal = function(opt_data, opt_sb) {
  var output = opt_sb || new soy.StringBuilder();
  output.append('<div id="g-challenge-mini-modal" class="jive-modal j-modal j-people-list-modal"><header><h2>', soy.$$escapeHtml(opt_data.challenge.name), '</h2></header><a href="#" class="j-modal-close-top close">', soy.$$escapeHtml(jive.i18n._i18n('1ce366',[])), '  <span class="j-close-icon j-ui-elem"></span></a><section  class="jive-modal-content clearfix"><div class="g-challenge-wrapper">', (opt_data.challenge.fullUrl) ? '<img class="g-challenge-image" alt="" src="' + soy.$$escapeHtml(opt_data.challenge.fullUrl) + '"/>' : '<img class="g-challenge-image" alt="" src="' + soy.$$escapeHtml(jive.soy.func.resourceUrl('/plugins/gamification/resources/images/missing_trophy.png',true)) + '"/>', (opt_data.challenge.description) ? '<span class="g-challenge-description">' + soy.$$filterNoAutoescape(opt_data.challenge.description) + '</span>' : '', '</div><div class="g-recently-completed">', soy.$$escapeHtml(jive.i18n._i18n('cdc981',[])), soy.$$escapeHtml(jive.i18n._i18n('49daab',[])), '</div>');
  jive.soy.acclaim.renderUserList({activityType: 'challenges', users: opt_data.recentCompleters, currentUserID: opt_data.currentUserID, onlyFriends: false, id: 'modal-challenges-everyone', classNames: 'challenges-everyone-list js-everyone-list', show: true}, output);
  output.append('</section></div>');
  return opt_sb ? '' : output.toString();
};
