// This file was automatically generated from rteMsgQuote.soy.
// Please don't edit this file by hand.

goog.provide('jive.DiscussionApp.soy.rteMsgQuote');

goog.require('soy');
goog.require('soydata');
goog.require('soy.StringBuilder');
goog.require('jive.soy.helpers.substitute');


jive.DiscussionApp.soy.rteMsgQuote = function(opt_data, opt_sb) {
  var output = opt_sb || new soy.StringBuilder();
  output.append('<div class="jive-rendered-content"><blockquote class="jive-quote"><span class="jive-quote-header">');
  if (opt_data.isAnonymous) {
    output.append(soy.$$escapeHtml(opt_data.i18n.postGuestWroteLabel));
  } else {
    jive.soy.helpers.substitute({string: opt_data.i18n.postUserWroteLabel, zero: soy.$$escapeHtml(opt_data.userName)}, output);
  }
  output.append(':</span><br/><br/>', soy.$$filterNoAutoescape(opt_data.msgBody), '</blockquote></div>');
  return opt_sb ? '' : output.toString();
};
