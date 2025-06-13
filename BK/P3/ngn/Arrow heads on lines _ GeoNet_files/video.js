// This file was automatically generated from video.soy.
// Please don't edit this file by hand.

goog.provide('jive.integration.tiles.viewstyle.video');

goog.require('soy');
goog.require('soydata');
goog.require('soy.StringBuilder');
goog.require('jive.integration.tiles.view.footer');
goog.require('jive.integration.tiles.view.header');
goog.require('jive.integration.tiles.viewstyle.tileVideoInfo');


jive.integration.tiles.viewstyle.video = function(opt_data, opt_sb) {
  var output = opt_sb || new soy.StringBuilder();
  jive.integration.tiles.view.header(opt_data, output);
  output.append('<section class="j-tile-body j-tile-video">');
  if (typeof(opt_data.video) == 'string') {
    output.append('<p class="noContent">', soy.$$escapeHtml(opt_data.video), '</p>');
  } else {
    jive.integration.tiles.viewstyle.tileVideoInfo(opt_data, output);
  }
  output.append('</section>');
  if (opt_data.action) {
    jive.integration.tiles.view.footer(opt_data.action, output);
  }
  return opt_sb ? '' : output.toString();
};
