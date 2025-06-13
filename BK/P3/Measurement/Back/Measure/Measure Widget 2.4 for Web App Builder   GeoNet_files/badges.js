// This file was automatically generated from badges.soy.
// Please don't edit this file by hand.

goog.provide('jive.unified.content.view.badges');

goog.require('soy');
goog.require('soydata');
goog.require('soy.StringBuilder');
goog.require('jive.unified.content.view.badge');


jive.unified.content.view.badges = function(opt_data, opt_sb) {
  var output = opt_sb || new soy.StringBuilder();
  var outcomeList3 = opt_data.outcomes;
  var outcomeListLen3 = outcomeList3.length;
  for (var outcomeIndex3 = 0; outcomeIndex3 < outcomeListLen3; outcomeIndex3++) {
    var outcomeData3 = outcomeList3[outcomeIndex3];
    jive.unified.content.view.badge({outcome: outcomeData3, outcomeType: String(outcomeData3.outcomeType).toLowerCase(), outcomeCount: outcomeData3.outcomeCount}, output);
  }
  return opt_sb ? '' : output.toString();
};
